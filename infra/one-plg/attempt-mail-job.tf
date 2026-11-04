# Optional private execution of the existing attempt cycle beside the mailbox.
# No nonproduction runtime receives Production database or OAuth access.
# Empty by default; creating these jobs does not execute them.
variable "attempt_mail_job_releases" {
  description = "Exact Dev-qualified images for private Dev/UAT receipt jobs. Keep scheduled=false until the controlled owner cycle, feedback and Inbox proof pass."
  type = map(object({
    image                 = string
    source                = string
    source_secret_version = string
    client_id             = string
    client_secret_version = string
    scheduled             = bool
  }))
  default = {}
  validation {
    condition = alltrue([for lane, release in var.attempt_mail_job_releases :
      contains(["dev", "uat"], lane) && contains(var.owner_environments, lane) &&
      !contains(keys(var.attempt_worker_releases), lane) &&
      can(regex("^us-central1-docker.pkg.dev/hushh-pda-dev/matrix-images/hushh-matrix-dashboard@sha256:[a-f0-9]{64}$", release.image)) &&
      can(regex("^[a-f0-9]{40}$", release.source)) &&
      can(regex("^[1-9][0-9]*$", release.source_secret_version)) &&
      can(regex("^[1-9][0-9]*$", release.client_secret_version)) &&
      can(regex("^[0-9]+-[a-z0-9]+\\.apps\\.googleusercontent\\.com$", release.client_id))
    ])
    error_message = "Use existing Dev/UAT foundations, exact qualified image/source and pinned secret versions. A lane cannot also run the route-based worker."
  }
}

resource "google_service_account" "attempt_mail_job" {
  for_each     = var.attempt_mail_job_releases
  project      = local.project
  account_id   = "one-plg-attempt-mail-${each.key}"
  display_name = "Private ${each.key} attempt receipt sender"
}

# This is a dedicated Production mail-process identity, not a Dev/UAT web
# identity. Firestore IAM is database-scoped; the fixed entrypoint accesses only
# one_plg_mail/control. It cannot be used as a generic HTTP database proxy.
resource "google_project_iam_custom_role" "attempt_mail_control" {
  count       = length(var.attempt_mail_job_releases) > 0 ? 1 : 0
  project     = local.project
  role_id     = "onePlgAttemptMailControl"
  title       = "Attempt mail control transaction"
  description = "Read and upsert the fixed mail-control record; no query, listing, deletion, export or administration."
  permissions = ["datastore.databases.get", "datastore.entities.get", "datastore.entities.create", "datastore.entities.update"]
}

resource "google_project_iam_member" "attempt_mail_job_control" {
  for_each = var.attempt_mail_job_releases
  project  = local.project
  role     = google_project_iam_custom_role.attempt_mail_control[0].name
  member   = "serviceAccount:${google_service_account.attempt_mail_job[each.key].email}"
  condition {
    title      = "attempt-mail-control-database"
    expression = "resource.name == 'projects/${local.project}/databases/one-plg-production'"
  }
}

resource "google_secret_manager_secret_iam_member" "attempt_mail_job_grant" {
  for_each  = var.attempt_mail_job_releases
  project   = local.project
  secret_id = google_secret_manager_secret.config["metrics-one-plg-google-mail"].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.attempt_mail_job[each.key].email}"
}

resource "google_secret_manager_secret_iam_member" "attempt_mail_job_oauth" {
  for_each  = var.attempt_mail_job_releases
  project   = local.project
  secret_id = "metrics-dashboard-google-client-secret"
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.attempt_mail_job[each.key].email}"
}

resource "google_secret_manager_secret_iam_member" "attempt_mail_job_source" {
  for_each  = var.attempt_mail_job_releases
  project   = local.owner_projects[each.key]
  secret_id = google_secret_manager_secret.owner_config["${each.key}/metrics-one-plg-attempt-source-secret"].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.attempt_mail_job[each.key].email}"
}

# The Production Run service agent pulls only the qualified Dev registry image.
resource "google_artifact_registry_repository_iam_member" "attempt_mail_image_pull" {
  count      = length(var.attempt_mail_job_releases) > 0 ? 1 : 0
  project    = "hushh-pda-dev"
  location   = "us-central1"
  repository = google_artifact_registry_repository.owner_images[0].repository_id
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:service-1072839345524@serverless-robot-prod.iam.gserviceaccount.com"
}

resource "google_cloud_run_v2_job" "attempt_mail" {
  for_each            = var.attempt_mail_job_releases
  project             = local.project
  name                = "one-plg-attempt-mail-${each.key}"
  location            = "us-central1"
  deletion_protection = true
  labels              = { "plg-environment" = each.key, "source-sha" = each.value.source }
  template {
    task_count  = 1
    parallelism = 1
    template {
      service_account = google_service_account.attempt_mail_job[each.key].email
      timeout         = "300s"
      max_retries     = 0
      containers {
        image   = each.value.image
        command = ["node", "--import", "tsx"]
        args    = ["scripts/plg-attempt-mail-job.ts"]
        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = local.project
        }
        env {
          name  = "PLG_ATTEMPT_MAIL_JOB_ENABLED"
          value = "true"
        }
        env {
          name  = "PLG_ATTEMPT_ENVIRONMENT"
          value = each.key
        }
        env {
          name  = "PLG_ATTEMPT_GOOGLE_CLIENT_ID"
          value = each.value.client_id
        }
        env {
          name = "PLG_ATTEMPT_SOURCE_SECRET"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.owner_config["${each.key}/metrics-one-plg-attempt-source-secret"].id
              version = each.value.source_secret_version
            }
          }
        }
        env {
          name = "PLG_ATTEMPT_GOOGLE_CLIENT_SECRET"
          value_source {
            secret_key_ref {
              secret  = "metrics-dashboard-google-client-secret"
              version = each.value.client_secret_version
            }
          }
        }
        resources { limits = { cpu = "1", memory = "512Mi" } }
      }
    }
  }
  depends_on = [google_project_iam_member.attempt_mail_job_control,
    google_secret_manager_secret_iam_member.attempt_mail_job_grant,
    google_secret_manager_secret_iam_member.attempt_mail_job_oauth,
    google_secret_manager_secret_iam_member.attempt_mail_job_source,
  google_artifact_registry_repository_iam_member.attempt_mail_image_pull]
}

resource "google_service_account" "attempt_mail_scheduler" {
  for_each     = var.attempt_mail_job_releases
  project      = local.project
  account_id   = "one-plg-mail-schedule-${each.key}"
  display_name = "Private ${each.key} receipt job invoker"
}

resource "google_cloud_run_v2_job_iam_member" "attempt_mail_invoke" {
  for_each = var.attempt_mail_job_releases
  project  = local.project
  location = "us-central1"
  name     = google_cloud_run_v2_job.attempt_mail[each.key].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.attempt_mail_scheduler[each.key].email}"
}

resource "google_cloud_scheduler_job" "attempt_mail" {
  for_each         = var.attempt_mail_job_releases
  project          = local.project
  name             = "one-plg-attempt-mail-${each.key}"
  region           = "us-central1"
  schedule         = "* * * * *"
  time_zone        = "Etc/UTC"
  paused           = !each.value.scheduled
  attempt_deadline = "180s"
  retry_config { retry_count = 0 }
  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/${google_cloud_run_v2_job.attempt_mail[each.key].id}:run"
    headers     = { "Content-Type" = "application/json" }
    body        = base64encode("{}")
    oauth_token { service_account_email = google_service_account.attempt_mail_scheduler[each.key].email }
  }
  depends_on = [google_cloud_run_v2_job_iam_member.attempt_mail_invoke]
}
