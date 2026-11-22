import { UserManager, WebStorageStateStore } from 'oidc-client-ts';
const authority=import.meta.env.VITE_OIDC_AUTHORITY as string|undefined;
const clientId=import.meta.env.VITE_OIDC_CLIENT_ID as string|undefined;
export const oidcEnabled=!!(authority&&clientId);
export const userManager=oidcEnabled?new UserManager({authority:authority!,client_id:clientId!,redirect_uri:`${location.origin}${import.meta.env.BASE_URL}auth/callback`,post_logout_redirect_uri:`${location.origin}${import.meta.env.BASE_URL}`,response_type:'code',scope:'openid profile email',userStore:new WebStorageStateStore({store:window.sessionStorage}),automaticSilentRenew:true}):null;
export async function accessToken(){const user=await userManager?.getUser();if(user?.access_token)return user.access_token;const localToken=import.meta.env.VITE_DEV_AUTH_TOKEN as string|undefined;return location.hostname==='localhost'||location.hostname==='127.0.0.1'?localToken||null:null;}
