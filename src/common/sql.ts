/** Builds an ILIKE pattern that matches the text literally anywhere. */
export const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;