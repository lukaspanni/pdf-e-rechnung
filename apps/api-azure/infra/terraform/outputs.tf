output "function_app_name" {
  value = azurerm_function_app_flex_consumption.api.name
}

output "function_app_hostname" {
  value = azurerm_function_app_flex_consumption.api.default_hostname
}

output "runtime_storage_account_name" {
  value = azurerm_storage_account.runtime.name
}
