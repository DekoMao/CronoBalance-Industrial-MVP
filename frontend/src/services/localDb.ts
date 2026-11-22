import Dexie, { type Table } from 'dexie';
import type { OutboxItem, Study } from '../domain/types';
class CronoDb extends Dexie {
  studies!:Table<Study,string>; outbox!:Table<OutboxItem,string>; meta!:Table<{key:string;value:unknown},string>;
  constructor(){super('cronobalance-industrial-v24');this.version(1).stores({studies:'id,version',outbox:'id,studyId,createdAt',meta:'key'});}
}
export const localDb=new CronoDb();
export async function localSave(study:Study){await localDb.studies.put(study);await localDb.meta.put({key:'lastSavedAt',value:new Date().toISOString()});}
export async function enqueue(study:Study,operations:Record<string,unknown>[]){const item:OutboxItem={id:crypto.randomUUID(),studyId:study.id,baseVersion:study.version,operations,createdAt:new Date().toISOString()};await localDb.outbox.add(item);return item;}
