terraform {
  required_version = ">= 1.6"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
  }
}

provider "google" {
  project = "hushh-ai-prod"
  region  = "us-central1"
}

variable "worker_image" {
  description = "Set only after secret versions exist; null provisions storage and IAM without creating the worker."
  type        = string
  default     = null
  validation {
    condition     = var.worker_image == null || can(regex("^us-central1-docker.pkg.dev/hushh-ai-prod/website-images/hushh-matrix-dashboard@sha256:[a-f0-9]{64}$", var.worker_image))
    error_message = "Use an immutable dashboard image digest from the existing production registry."
  }
}
variable "automatic_cycles" {
  description = "Use the reviewed server-owned cycle instead of the legacy sync-only worker. Requires its signing-key version. Campaign sending still requires independent runtime and website gates."
  type        = bool
  default     = false
}
variable "scheduler_enabled" {
  description = "Enable scheduled polling only after a controlled cycle succeeds on the promoted revision."
  type        = bool
  default     = false
}

locals {
  project = "hushh-ai-prod"
  runtime = "metrics-dashboard-runtime@hushh-ai-prod.iam.gserviceaccount.com"
  secrets = toset([
    "metrics-one-plg-signing-secret", "metrics-one-plg-source-secret",
    "metrics-one-plg-sync-secret", "metrics-one-plg-cycle-secret",
    "metrics-one-plg-audience-secret", "metrics-one-plg-subscription-secret",
    "metrics-one-plg-admin-emails", "metrics-one-plg-operator-emails",
    "metrics-one-plg-email-from", "metrics-one-plg-reply-to",
    "metrics-one-plg-resend-api-key", "metrics-one-plg-resend-webhook-secret"
  ])
}

# The existing (default) database is Datastore mode. Do not convert or replace it.
resource "google_firestore_database" "pilot" {
  name                              = "one-plg-production"
  location_id                       = "us-central1"
  type                              = "FIRESTORE_NATIVE"
  delete_protection_state           = "DELETE_PROTECTION_ENABLED"
  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_ENABLED"
  lifecycle { prevent_destroy = true }
}

resource "google_project_iam_member" "database_access" {
  project = local.project
  role    = "roles/datastore.user"
  member  = "serviceAccount:${local.runtime}"
  condition {
    title      = "one-plg-database-only"
    expression = "resource.name == 'projects/${local.project}/databases/one-plg-production'"
  }
}

# Containers only. Values never enter Terraform state; use Secret Manager stdin.
resource "google_secret_manager_secret" "config" {
  for_each  = local.secrets
  secret_id = each.key
  replication {
    auto {}
  }
  lifecycle { prevent_destroy = true }
}

resource "google_secret_manager_secret_iam_member" "dashboard_access" {
  for_each  = google_secret_manager_secret.config
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.runtime}"
}

resource "google_secret_manager_secret" "one_config" {
  for_each  = toset(["ONE_PLG_EXPORT_SECRET", "ONE_PLG_EXPORT_ACCOUNT_IDS", "ONE_PLG_AUDIENCE_SECRET", "ONE_PLG_SUBSCRIPTION_SECRET"])
  project   = "hushh-pda"
  secret_id = each.key
  replication {
    auto {}
  }
  lifecycle { prevent_destroy = true }
}

resource "google_secret_manager_secret_iam_member" "one_source_access" {
  for_each  = google_secret_manager_secret.one_config
  project   = "hushh-pda"
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:consent-protocol-runtime@hushh-pda.iam.gserviceaccount.com"
}

resource "google_service_account" "worker" {
  account_id   = "one-plg-worker"
  display_name = "One PLG task evidence worker"
}

resource "google_secret_manager_secret_iam_member" "worker_key" {
  secret_id = google_secret_manager_secret.config["metrics-one-plg-sync-secret"].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}
resource "google_secret_manager_secret_iam_member" "worker_cycle_key" {
  count     = var.automatic_cycles ? 1 : 0
  secret_id = google_secret_manager_secret.config["metrics-one-plg-cycle-secret"].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_cloud_run_v2_job" "sync" {
  count               = var.worker_image == null ? 0 : 1
  name                = "one-plg-sync"
  location            = "us-central1"
  deletion_protection = true
  template {
    task_count  = 1
    parallelism = 1
    template {
      service_account = google_service_account.worker.email
      timeout         = "300s"
      max_retries     = 0
      containers {
        image   = var.worker_image
        command = ["node"]
        args    = ["scripts/plg-worker.mjs", var.automatic_cycles ? "--cycle" : "--sync-only"]
        env {
          name  = "PLG_PUBLIC_ORIGIN"
          value = "https://metrics.hussh.ai"
        }
        dynamic "env" {
          for_each = var.automatic_cycles ? [1] : []
          content {
            name = "PLG_CYCLE_SECRET"
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.config["metrics-one-plg-cycle-secret"].secret_id
                version = "latest"
              }
            }
          }
        }
        env {
          name = "PLG_SYNC_SECRET"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.config["metrics-one-plg-sync-secret"].secret_id
              version = "latest"
            }
          }
        }
        resources { limits = { cpu = "1", memory = "512Mi" } }
      }
    }
  }
  depends_on = [google_secret_manager_secret_iam_member.worker_key, google_secret_manager_secret_iam_member.worker_cycle_key]
}

resource "google_service_account" "scheduler" {
  account_id   = "one-plg-scheduler"
  display_name = "One PLG sync scheduler"
}

resource "google_cloud_run_v2_job_iam_member" "invoke_sync" {
  count    = var.worker_image == null ? 0 : 1
  project  = local.project
  location = "us-central1"
  name     = google_cloud_run_v2_job.sync[0].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_cloud_scheduler_job" "sync" {
  count            = var.worker_image == null ? 0 : 1
  name             = "one-plg-sync"
  region           = "us-central1"
  schedule         = "*/15 * * * *"
  time_zone        = "Etc/UTC"
  paused           = !var.scheduler_enabled
  attempt_deadline = "180s"
  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/${google_cloud_run_v2_job.sync[0].id}:run"
    headers     = { "Content-Type" = "application/json" }
    body        = base64encode("{}")
    oauth_token { service_account_email = google_service_account.scheduler.email }
  }
  depends_on = [google_cloud_run_v2_job_iam_member.invoke_sync]
}

output "database" { value = google_firestore_database.pilot.id }
output "secret_names" { value = keys(google_secret_manager_secret.config) }
