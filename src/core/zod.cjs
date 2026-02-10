function formatIssues(issues) {
  const arr = Array.isArray(issues) ? issues : [];
  return arr.map((i) => ({
    path: Array.isArray(i.path) ? i.path.join(".") : String(i.path || ""),
    message: typeof i.message === "string" ? i.message : "Invalid",
  }));
}

module.exports = { formatIssues };
