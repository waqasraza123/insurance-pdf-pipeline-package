const { createLeadHandlers } = require("./createLeadHandlers.cjs");
const {
  createSubmissionCreatedHandler,
} = require("./createSubmissionCreatedHandler.cjs");

module.exports = { createLeadHandlers, createSubmissionCreatedHandler };
