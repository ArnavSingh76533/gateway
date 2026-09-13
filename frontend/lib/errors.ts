export function errorGuidance(status?: number, code?: string): string {
  if (code === "account_suspended")
    return "Contact the gateway administrator to restore your account.";
  if (code === "admin_required")
    return "Use an account with an administrator role granted on the server.";
  if (status === 402)
    return "The provider requires payment or available credit. Check the provider account's billing and model access.";
  if (status === 401 || status === 403)
    return "Check the selected provider's credentials and access permissions. For a session error, sign in again.";
  if (status === 429)
    return "Wait for the rate-limit window to reset, or choose another available model.";
  if (status === 404 || code === "no_matching_model")
    return "Choose an available model or refresh the provider catalog. Check the required capabilities.";
  if (status === 400 || status === 422)
    return "Review the selected model and request settings before sending again.";
  if (status === 413) return "Shorten the prompt or reduce the request size.";
  return "The request could not complete. Retry later or choose another model; request details show the provider attempts.";
}
