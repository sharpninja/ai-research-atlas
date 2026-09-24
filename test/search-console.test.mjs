import test from 'node:test';
import assert from 'node:assert/strict';
import {searchConsoleSummary} from '../src/search-console.js';

test('Search Console signs in with a service account and minimizes returned fields', async () => {
  const pair = await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const bytes = new Uint8Array(await crypto.subtle.exportKey('pkcs8',pair.privateKey));
  const pem = '-----BEGIN PRIVATE KEY-----\n'+Buffer.from(bytes).toString('base64').match(/.{1,64}/g).join('\n')+'\n-----END PRIVATE KEY-----\n';
  const calls=[]; const fetcher=async (url,options) => {
    calls.push({url,options});
    if (calls.length===1) return Response.json({access_token:'test-token'});
    return Response.json({rows:[{keys:['artificial intelligence history','https://atlas.example/timeline/'],clicks:3,impressions:40,ctr:.075,position:4.2,extra:'discard'}]});
  };
  const result=await searchConsoleSummary({SEARCH_CONSOLE_SITE_URL:'https://atlas.example/',GOOGLE_SERVICE_ACCOUNT_EMAIL:'atlas@example.test',GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY:pem},7,fetcher);
  assert.equal(result.configured,true); assert.equal(result.rows.length,1);
  assert.deepEqual(result.rows[0],{query:'artificial intelligence history',page:'https://atlas.example/timeline/',clicks:3,impressions:40,ctr:.075,position:4.2});
  assert.equal(calls[0].url,'https://oauth2.googleapis.com/token'); assert.match(calls[0].options.body.toString(),/assertion=/);
  assert.match(calls[1].url,/searchAnalytics\/query$/); assert.equal(calls[1].options.headers.Authorization,'Bearer test-token');
  const body=JSON.parse(calls[1].options.body); assert.deepEqual(body.dimensions,['query','page']); assert.equal(body.dataState,'all'); assert.equal(body.rowLimit,1000);
});

test('Search Console reports unconfigured state without making a network request', async () => {
  let called=false; const result=await searchConsoleSummary({},30,async()=>{called=true;});
  assert.deepEqual(result,{configured:false,rows:[]}); assert.equal(called,false);
});
