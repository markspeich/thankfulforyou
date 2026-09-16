import { describe,it,expect,vi } from 'vitest';
import { buildProductionPayload,createListingAmazonProductionService } from '../../api/_lib/listing-amazon-production.js';
const draft={id:'abc',revision:1,title:'Title',description:'Description',bullets:['a','b','c','d','e'],copyApproved:true,amazonProductionDetails:{packageLengthInches:3,packageWidthInches:2,packageHeightInches:1,packageWeightOunces:1.1,manufacturer:'Thankful For You',partNumber:'TFY-4357670739',specialFeature:'Personalized',closureType:'Clip'},images:[{id:'img',url:'https://images.example.com/a.jpg',selected:true,main:true,approved:true}]};
function setup(client){const attempts={list:vi.fn(async()=>[]),claim:vi.fn(async()=>({id:'attempt'})),finish:vi.fn(async()=>{})};return {attempts,service:createListingAmazonProductionService({attempts,client,configured:()=>true,sellerId:()=> 'seller',imageDelivery:{configured:()=>false}})};}
describe('production listing workflow',()=>{
 it('maps saved package facts for every listing',()=>{
  const attributes=buildProductionPayload({...draft,etsyListingId:'different',amazonProductionDetails:{packageLengthInches:3,packageWidthInches:2,packageHeightInches:1,packageWeightOunces:1.1,manufacturer:'Thankful For You',partNumber:'TFY-4357670739',specialFeature:'Personalized',closureType:'Clip'}}).payload.attributes;
  expect(attributes.item_package_weight[0]).toMatchObject({value:1.1,unit:'ounces'});
  expect(attributes.item_package_dimensions[0]).toMatchObject({length:{value:3,unit:'inches'},width:{value:2,unit:'inches'},height:{value:1,unit:'inches'}});
  expect(attributes.part_number[0].value).toBe('TFY-4357670739');
  expect(attributes.manufacturer[0].value).toBe('Thankful For You');
  expect(attributes.special_feature[0].value).toBe('Personalized');
  expect(attributes.closure[0].type[0].value).toBe('Clip');
 });
 it('blocks production validation when saved package facts are missing',()=>{
  expect(buildProductionPayload({...draft,amazonProductionDetails:{}}).issues.join(' ')).toMatch(/production details/i);
 });
 it('binds the production content hash to saved production details',()=>{
  const changed={...draft,amazonProductionDetails:{...draft.amazonProductionDetails,partNumber:'TFY-OTHER'}};
  expect(buildProductionPayload(changed).hash).not.toBe(buildProductionPayload(draft).hash);
 });
 it('builds product-only payload without offer or price',()=>{const result=buildProductionPayload(draft);expect(result.issues).toEqual([]);expect(result.payload.productType).toBe('BADGE_HOLDER');expect(result.payload.requirements).toBe('LISTING_PRODUCT_ONLY');expect(result.payload.attributes.country_of_origin[0].value).toBe('US');expect(JSON.stringify(result.payload)).not.toContain('purchasable_offer');});
 it.each(['http://localhost/a','https://127.0.0.1/a','https://10.1.2.3/a','https://mark.tail123.ts.net/a','https://[::1]/a'])('rejects private image URL %s',(url)=>{expect(buildProductionPayload({...draft,images:[{...draft.images[0],url}]}).issues.join(' ')).toMatch(/public/i);});
 it('requires explicit submission confirmation',async()=>{const {service,attempts}=setup({});await expect(service.run({workspaceId:'w',draft,action:'submit'})).rejects.toThrow(/confirm/i);expect(attempts.claim).not.toHaveBeenCalled();});
 it('never overwrites an existing SKU',async()=>{const client={get:vi.fn(async()=>({summaries:[]})),submit:vi.fn()};const {service,attempts}=setup(client);await service.run({workspaceId:'w',draft,action:'submit',confirmed:true});expect(client.submit).not.toHaveBeenCalled();expect(attempts.finish.mock.calls[0][0].status).toBe('failed');});
 it('keeps accepted separate from inactive',async()=>{const {service,attempts}=setup({get:async()=>null,submit:async()=>({status:'ACCEPTED'})});await service.run({workspaceId:'w',draft,action:'submit',confirmed:true});expect(attempts.finish.mock.calls[0][0].status).toBe('accepted');});
 it('does not confirm missing listing inactive',async()=>{const {service,attempts}=setup({get:async()=>null});await service.run({workspaceId:'w',draft,action:'reconcile'});expect(attempts.finish.mock.calls[0][0].status).toBe('unconfirmed');});
 it('flags buyable listings',async()=>{const {service,attempts}=setup({get:async()=>({summaries:[{marketplaceId:'ATVPDKIKX0DER',status:['BUYABLE']} ]})});await service.run({workspaceId:'w',draft,action:'reconcile'});expect(attempts.finish.mock.calls[0][0].status).toBe('buyable');});
 it('keeps preview identity stable across expiring delivery URLs',()=>{expect(buildProductionPayload(draft).hash).toBe(buildProductionPayload({...draft,images:[{...draft.images[0],url:'https://images.example.com/a.jpg?token=another'}]}).hash);});
 it('treats unexpected errors after submitting as uncertain',async()=>{const {service,attempts}=setup({get:async()=>null,submit:async()=>{throw new Error('network')}});await service.run({workspaceId:'w',draft,action:'submit',confirmed:true});expect(attempts.finish.mock.calls[0][0].status).toBe('unknown');});
});
