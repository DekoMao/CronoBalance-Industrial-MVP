const base=(import.meta.env.VITE_API_BASE_URL as string|undefined)?.replace(/\/$/,'');
export const apiConfigured=!!base;
export class ApiError extends Error{constructor(public status:number,public body:any){super(body?.detail||body?.title||`API ${status}`)}}
