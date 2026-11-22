import { defineConfig } from '@playwright/test';
const base=process.env.VITE_BASE_PATH||'/';
export default defineConfig({
  testDir:'./tests',testMatch:process.env.CB_CLOUD_TEST?'**/cloud.spec.ts':'**/industrial.spec.ts',timeout:30000,expect:{timeout:6500},workers:2,retries:process.env.CI?1:0,
  use:{baseURL:'http://127.0.0.1:4179'+base,viewport:{width:1600,height:1000},trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:{command:'npm run preview -- --host 127.0.0.1 --port 4179 --strictPort',url:'http://127.0.0.1:4179'+base,reuseExistingServer:false},
  reporter:[['list'],['html',{open:'never'}]]
});