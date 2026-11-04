# Additive foundation under the existing locked PLG state. No Production address,
# identity, secret value, database, traffic or scheduler changes are required.
variable "owner_environments" {
  description = "Opt-in Dev/UAT owner-read foundations. Apply a reviewed plan before dispatch; this does not activate source reads or mail."
  type        = set(string)
  default     = []
  validation {
    condition     = alltrue([for lane in var.owner_environments : contains(["dev", "uat"], lane)]) && (!contains(var.owner_environments, "uat") || contains(var.owner_environments, "dev"))
    error_message = "Only Dev and UAT are supported; provision Dev before UAT."
  }
}

locals {
  owner_projects = { for lane in var.owner_environments : lane => "hushh-pda-${lane}" }
  owner_secret_names = toset([
    "metrics-dashboard-google-client-secret", "metrics-dashboard-session-secret", "metrics-dashboard-allowed-emails",
    "metrics-one-plg-owner-source-secret", "metrics-one-plg-owner-email-hashes",
    "metrics-one-plg-attempt-source-secret", "metrics-one-plg-attempt-worker-secret"
  ])
  owner_secrets = { for entry in flatten([for lane, project in local.owner_projects : [for name in local.owner_secret_names : {
    lane = lane, project = project, name = name
  }]]) : "${entry.lane}/${entry.name}" => entry }
}

resource "google_service_account" "owner_runtime" {
  for_each     = local.owner_projects
  project      = each.value
  account_id   = "matrix-runtime"
  display_name = "Matrix ${each.key} verified owner activity"
}

resource "google_service_account" "owner_deployer" {
  for_each     = local.owner_projects
  project      = each.value
  account_id   = "matrix-deployer"
  display_name = "Canonical Matrix ${each.key} deployment"
}

resource "google_service_account_iam_member" "owner_deployer_federation" {
  for_each           = local.owner_projects
  service_account_id = google_service_account.owner_deployer[each.key].name
  role               = "roles/iam.workloadIdentityUser"
  # Existing provider independently restricts this repository to refs/heads/main.
  member = "principalSet://iam.googleapis.com/projects/1072839345524/locations/global/workloadIdentityPools/github-actions/attribute.repository/hushh-labs/hussh-matrix-dashboard"
}

resource "google_service_account_iam_member" "owner_runtime_act_as" {
  for_each           = local.owner_projects
  service_account_id = google_service_account.owner_runtime[each.key].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.owner_deployer[each.key].email}"
}

resource "google_project_iam_member" "owner_deploy_run" {
  for_each = local.owner_projects
  project  = each.value
  role     = "roles/run.admin"
  member   = "serviceAccount:${google_service_account.owner_deployer[each.key].email}"
}

resource "google_secret_manager_secret" "owner_config" {
  for_each  = local.owner_secrets
  project   = each.value.project
  secret_id = each.value.name
  replication {
    auto {}
  }
  lifecycle { prevent_destroy = true }
}

resource "google_secret_manager_secret_iam_member" "owner_config_read" {
  for_each  = local.owner_secrets
  project   = each.value.project
  secret_id = google_secret_manager_secret.owner_config[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.owner_runtime[each.value.lane].email}"
}

resource "google_secret_manager_secret_iam_member" "owner_config_metadata" {
  for_each  = local.owner_secrets
  project   = each.value.project
  secret_id = google_secret_manager_secret.owner_config[each.key].id
  role      = "roles/secretmanager.viewer"
  member    = "serviceAccount:${google_service_account.owner_deployer[each.value.lane].email}"
}

resource "google_artifact_registry_repository" "owner_images" {
  count         = contains(var.owner_environments, "dev") ? 1 : 0
  project       = "hushh-pda-dev"
  location      = "us-central1"
  repository_id = "matrix-images"
  format        = "DOCKER"
  lifecycle { prevent_destroy = true }
}

resource "google_artifact_registry_repository_iam_member" "owner_image_deployer" {
  for_each   = local.owner_projects
  project    = "hushh-pda-dev"
  location   = "us-central1"
  repository = google_artifact_registry_repository.owner_images[0].repository_id
  role       = each.key == "dev" ? "roles/artifactregistry.writer" : "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.owner_deployer[each.key].email}"
}

resource "google_artifact_registry_repository_iam_member" "owner_uat_image_pull" {
  count      = contains(var.owner_environments, "uat") ? 1 : 0
  project    = "hushh-pda-dev"
  location   = "us-central1"
  repository = google_artifact_registry_repository.owner_images[0].repository_id
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:service-745506018753@serverless-robot-prod.iam.gserviceaccount.com"
}

output "owner_runtime_accounts" { value = { for lane, account in google_service_account.owner_runtime : lane => account.email } }

# The existing worker entrypoint invokes only its environment's signed route.
# No source credential, OAuth grant or database access is granted to the job.
variable "attempt_worker_releases" {
  description = "Exact accepted Dev/UAT runtime digests. Keep empty until runtime/source/mailbox authority is verified; keep scheduling paused until a controlled own-recipient cycle succeeds."
  type = map(object({
    image          = string
    source         = string
    secret_version = string
    scheduled      = bool
  }))
  default = {}
  validation {
    condition = alltrue([for lane, release in var.attempt_worker_releases :
      contains(["dev", "uat"], lane) &&
      can(regex("^us-central1-docker.pkg.dev/hushh-pda-dev/matrix-images/hushh-matrix-dashboard@sha256:[a-f0-9]{64}$", release.image)) &&
      can(regex("^[a-f0-9]{40}$", release.source)) && can(regex("^[1-9][0-9]*$", release.secret_version))
    ])
    error_message = "Use an exact Dev-built digest, source SHA and pinned worker-key version for an existing Dev/UAT foundation."
  }
}

resource "google_service_account" "attempt_worker" {
  for_each     = var.attempt_worker_releases
  project      = local.owner_projects[each.key]
  account_id   = "matrix-attempt-worker"
  display_name = "Matrix ${each.key} attempt worker"
}

resource "google_service_account" "attempt_scheduler" {
  for_each     = var.attempt_worker_releases
  project      = local.owner_projects[each.key]
  account_id   = "matrix-attempt-scheduler"
  display_name = "Matrix ${each.key} attempt scheduler"
}

resource "google_secret_manager_secret_iam_member" "attempt_worker_key" {
  for_each  = var.attempt_worker_releases
  project   = local.owner_projects[each.key]
  secret_id = google_secret_manager_secret.owner_config["${each.key}/metrics-one-plg-attempt-worker-secret"].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.attempt_worker[each.key].email}"
}

resource "google_cloud_run_v2_job" "attempt_worker" {
  for_each            = var.attempt_worker_releases
  project             = local.owner_projects[each.key]
  name                = "matrix-attempt-email"
  location            = "us-central1"
  deletion_protection = true
  labels              = { "plg-environment" = each.key, "source-sha" = each.value.source }
  template {
    task_count  = 1
    parallelism = 1
    template {
      service_account = google_service_account.attempt_worker[each.key].email
      timeout         = "300s"
      max_retries     = 0
      containers {
        image   = each.value.image
        command = ["node"]
        args    = ["scripts/plg-worker.mjs", "--attempts"]
        env {
          name  = "PLG_PUBLIC_ORIGIN"
          value = "https://hushh-matrix-dashboard-${each.key == "dev" ? "621416509462" : "745506018753"}.us-central1.run.app"
        }
        env {
          name  = "PLG_ATTEMPT_ENVIRONMENT"
          value = each.key
        }
        env {
          name = "PLG_ATTEMPT_WORKER_SECRET"
          value_source {
            secret_key_ref {
              secret  = "metrics-one-plg-attempt-worker-secret"
              version = each.value.secret_version
            }
          }
        }
        resources { limits = { cpu = "1", memory = "512Mi" } }
      }
    }
  }
  depends_on = [google_secret_manager_secret_iam_member.attempt_worker_key]
}

resource "google_cloud_run_v2_job_iam_member" "attempt_scheduler_invoke" {
  for_each = var.attempt_worker_releases
  project  = local.owner_projects[each.key]
  location = "us-central1"
  name     = google_cloud_run_v2_job.attempt_worker[each.key].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.attempt_scheduler[each.key].email}"
}

resource "google_cloud_scheduler_job" "attempt_worker" {
  for_each         = var.attempt_worker_releases
  project          = local.owner_projects[each.key]
  name             = "matrix-attempt-email"
  region           = "us-central1"
  schedule         = "* * * * *"
  time_zone        = "Etc/UTC"
  paused           = !each.value.scheduled
  attempt_deadline = "180s"
  retry_config { retry_count = 0 }
  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/${google_cloud_run_v2_job.attempt_worker[each.key].id}:run"
    headers     = { "Content-Type" = "application/json" }
    body        = base64encode("{}")
    oauth_token { service_account_email = google_service_account.attempt_scheduler[each.key].email }
  }
  depends_on = [google_cloud_run_v2_job_iam_member.attempt_scheduler_invoke]
}
