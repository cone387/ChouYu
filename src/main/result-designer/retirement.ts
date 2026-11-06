import type Database from 'better-sqlite3'
/** Retired author jobs are historical records, never requeued or handed off. */
export function retireAuthorPresentation(db:Database.Database){
  db.exec(`UPDATE runs SET status='cancelled',error='作者展示机制已移除，此旧请求已失效。'
    WHERE json_extract(input,'$.revisionScope')='presentation' AND status!='completed';
    UPDATE contact_interactions SET value=json_set(value,'$.status','obsolete','$.result','旧展示请求已失效，请使用成果区的界面设计入口。')
    WHERE (value LIKE '%revise_contact_presentation%' OR json_extract(value,'$.runId') IN (SELECT id FROM runs WHERE json_extract(input,'$.revisionScope')='presentation'))
      AND json_extract(value,'$.status') IN ('pending','executing','failed');
    DELETE FROM notices WHERE json_extract(value,'$.purpose')='presentation';`)
}
