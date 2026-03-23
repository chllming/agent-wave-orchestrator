function bearerTokenFromRequest(req) {
  const header = String(req.headers.authorization || "").trim();
  if (!header.toLowerCase().startsWith("bearer ")) {
    return "";
  }
  return header.slice("bearer ".length).trim();
}

export function isAuthorized(req, config, mode = "read") {
  const tokens = config.auth.tokens || [];
  if (tokens.length === 0) {
    return true;
  }
  if (mode === "read" && config.auth.requireAuthForReads === false) {
    return true;
  }
  const token = bearerTokenFromRequest(req);
  return tokens.includes(token);
}

export function requireAuthorization(req, config, mode = "read") {
  if (!isAuthorized(req, config, mode)) {
    const error = new Error("Unauthorized");
    error.statusCode = 401;
    throw error;
  }
}
