mock_provider "google" {}

variables {
  owner_environments = ["dev", "uat"]
  attempt_mail_job_releases = {
    dev = {
      image                 = "us-central1-docker.pkg.dev/hushh-pda-dev/matrix-images/hushh-matrix-dashboard@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      source                = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      source_secret_version = "1"
      client_id             = "123-test.apps.googleusercontent.com"
      client_secret_version = "1"
      scheduled             = false
    }
  }
}

run "private_job_is_paused_and_has_no_web_identity" {
  command = plan
  assert {
    condition     = google_cloud_run_v2_job.attempt_mail["dev"].project == "hushh-ai-prod" && google_service_account.attempt_mail_job["dev"].account_id == "one-plg-attempt-mail-dev"
    error_message = "Mail execution must stay beside the mailbox with a dedicated identity."
  }
  assert {
    condition     = google_cloud_run_v2_job.attempt_mail["dev"].template[0].template[0].max_retries == 0 && google_cloud_run_v2_job.attempt_mail["dev"].template[0].task_count == 1 && google_cloud_scheduler_job.attempt_mail["dev"].paused
    error_message = "Creation must not send or introduce provider retries."
  }
  assert {
    condition     = google_cloud_run_v2_job_iam_member.attempt_mail_invoke["dev"].role == "roles/run.invoker" && google_secret_manager_secret_iam_member.attempt_mail_job_grant["dev"].role == "roles/secretmanager.secretAccessor" && google_secret_manager_secret_iam_member.attempt_mail_job_source["dev"].project == "hushh-pda-dev"
    error_message = "Scheduler cannot override execution or read grants; mail job cannot rotate its grant or borrow another source."
  }
  assert {
    condition     = length(google_cloud_run_v2_job.attempt_worker) == 0 && google_cloud_scheduler_job.attempt_mail["dev"].http_target[0].body == base64encode("{}")
    error_message = "Only one delivery execution owner is admitted, without argument or environment overrides."
  }
  assert {
    condition     = toset(google_project_iam_custom_role.attempt_mail_control[0].permissions) == toset(["datastore.databases.get", "datastore.entities.get", "datastore.entities.create", "datastore.entities.update"])
    error_message = "Mail control must not receive list, delete, export or database administration authority."
  }
}

run "empty_configuration_has_no_mail_resources" {
  command = plan
  variables { attempt_mail_job_releases = {} }
  assert {
    condition     = length(google_cloud_run_v2_job.attempt_mail) == 0 && length(google_cloud_scheduler_job.attempt_mail) == 0 && length(google_service_account.attempt_mail_job) == 0 && length(google_project_iam_custom_role.attempt_mail_control) == 0
    error_message = "Default configuration must not provision mail infrastructure or IAM."
  }
}

run "duplicate_execution_owner_refused" {
  command = plan
  variables {
    attempt_worker_releases = {
      dev = {
        image          = "us-central1-docker.pkg.dev/hushh-pda-dev/matrix-images/hushh-matrix-dashboard@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        source         = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        secret_version = "1"
        scheduled      = false
      }
    }
  }
  expect_failures = [var.attempt_mail_job_releases]
}

run "unprovisioned_source_refused" {
  command = plan
  variables { owner_environments = [] }
  expect_failures = [var.attempt_mail_job_releases]
}
