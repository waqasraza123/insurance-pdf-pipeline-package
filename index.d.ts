export function createLeadHandlers(adapter: any): {
  handleLead: (event: any) => Promise<any>;
  handleLeadBackground: (event: any) => Promise<any>;
  leadStatus: (event: any) => Promise<any>;
  leadRetry: (event: any) => Promise<any>;
};

export function createSubmissionCreatedHandler(
  adapter: any,
): (event: any) => Promise<any>;

export const siteUtils: {
  email: any;
  pdf: any;
};
