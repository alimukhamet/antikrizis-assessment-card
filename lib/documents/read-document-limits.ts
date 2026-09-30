export const MAX_DOCUMENT_BYTES=35*1024*1024;
export class DocumentReadError extends Error {constructor(public code:string,public status=422){super(code);}}
