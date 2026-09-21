terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }

  backend "azurerm" {}
}

provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "api" {
  name     = var.resource_group_name
  location = var.location
  tags     = var.tags
}

resource "azurerm_storage_account" "runtime" {
  name                            = var.storage_account_name
  resource_group_name             = azurerm_resource_group.api.name
  location                        = azurerm_resource_group.api.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false
  tags                            = var.tags
}

resource "azurerm_storage_container" "releases" {
  name                  = "function-releases"
  storage_account_id    = azurerm_storage_account.runtime.id
  container_access_type = "private"
}

resource "azurerm_service_plan" "flex" {
  name                = "${var.function_app_name}-plan"
  resource_group_name = azurerm_resource_group.api.name
  location            = azurerm_resource_group.api.location
  os_type             = "Linux"
  sku_name            = "FC1"
  tags                = var.tags
}

resource "azurerm_application_insights" "api" {
  name                = var.application_insights_name
  resource_group_name = azurerm_resource_group.api.name
  location            = azurerm_resource_group.api.location
  application_type    = "web"
  tags                = var.tags
}

resource "azurerm_function_app_flex_consumption" "api" {
  name                = var.function_app_name
  resource_group_name = azurerm_resource_group.api.name
  location            = azurerm_resource_group.api.location
  service_plan_id     = azurerm_service_plan.flex.id

  storage_container_type      = "blobContainer"
  storage_container_endpoint  = "${azurerm_storage_account.runtime.primary_blob_endpoint}${azurerm_storage_container.releases.name}"
  storage_authentication_type = "StorageAccountConnectionString"
  storage_access_key          = azurerm_storage_account.runtime.primary_access_key
  runtime_name                = "node"
  runtime_version             = "22"
  maximum_instance_count      = var.maximum_instance_count
  instance_memory_in_mb       = 512
  https_only                  = true

  site_config {
    application_insights_connection_string = azurerm_application_insights.api.connection_string
    minimum_tls_version                    = "1.2"
  }

  app_settings = {
    FUNCTIONS_EXTENSION_VERSION = "~4"
    FUNCTIONS_WORKER_RUNTIME    = "node"
  }

  tags = var.tags
}
