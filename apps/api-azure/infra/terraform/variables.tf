variable "resource_group_name" {
  description = "Resource group for the API resources."
  type        = string
}

variable "location" {
  description = "Azure region supporting Flex Consumption."
  type        = string
}

variable "function_app_name" {
  description = "Globally unique Function App name (max 32 characters)."
  type        = string
}

variable "storage_account_name" {
  description = "Globally unique lowercase runtime/deployment storage name."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]{3,24}$", var.storage_account_name))
    error_message = "Storage account names must contain 3-24 lowercase letters and digits."
  }
}

variable "application_insights_name" {
  description = "Application Insights component name."
  type        = string
}

variable "maximum_instance_count" {
  description = "Flex Consumption maximum scale-out count."
  type        = number
  default     = 20

  validation {
    condition     = var.maximum_instance_count >= 1 && var.maximum_instance_count <= 1000
    error_message = "Flex Consumption allows between 1 and 1000 instances."
  }
}

variable "tags" {
  description = "Tags applied to Azure resources."
  type        = map(string)
  default     = {}
}
