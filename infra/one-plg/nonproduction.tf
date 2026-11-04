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
    "metrics-one-plg-owner-source-secret", "metrics-one-plg-owner-email-hashes"
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
