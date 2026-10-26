-- Generated with TasksStore from v1.3.4 (Third-party data is not used).
CREATE TABLE task_fields (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      options TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
CREATE TABLE task_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, is_default INTEGER NOT NULL DEFAULT 0);
CREATE TABLE task_projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, archived_at INTEGER, created_at INTEGER NOT NULL
    , group_id TEXT REFERENCES task_groups(id), is_default INTEGER NOT NULL DEFAULT 0);
CREATE TABLE task_views (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      project_ids TEXT NOT NULL DEFAULT '[]', priorities TEXT NOT NULL DEFAULT '[]',
      due_range TEXT NOT NULL DEFAULT 'any',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
CREATE TABLE tasks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, note TEXT,
      project_id TEXT REFERENCES task_projects(id),
      priority TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'open',
      due_at INTEGER, remind_at INTEGER, remind_fired_at INTEGER,
      recurrence TEXT NOT NULL DEFAULT 'none', recurrence_anchor_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER,
      custom_fields TEXT NOT NULL DEFAULT '{}'
    , recurrence_generated INTEGER NOT NULL DEFAULT 0, start_at INTEGER);
INSERT INTO "task_groups" ("id","name","is_default") VALUES ('efde94c7-e303-4aa0-a698-6d10cfffe19b','收集箱',1);
INSERT INTO "task_projects" ("id","name","archived_at","created_at","group_id","is_default") VALUES ('c86826fb-6694-446d-bc32-b49d95863c8b','默认清单',NULL,1793006750398,'efde94c7-e303-4aa0-a698-6d10cfffe19b',1);
INSERT INTO "tasks" ("id","title","note","project_id","priority","status","due_at","remind_at","remind_fired_at","recurrence","recurrence_anchor_at","created_at","updated_at","completed_at","custom_fields","recurrence_generated","start_at") VALUES ('873e93c8-6647-41b7-9ff7-f9c3abe49dbf','Legacy open task','v1.3.4 fixture','c86826fb-6694-446d-bc32-b49d95863c8b','high','open',4070908800000,NULL,NULL,'none',NULL,1793006750400,1793006750400,NULL,'{}',0,NULL);
INSERT INTO "tasks" ("id","title","note","project_id","priority","status","due_at","remind_at","remind_fired_at","recurrence","recurrence_anchor_at","created_at","updated_at","completed_at","custom_fields","recurrence_generated","start_at") VALUES ('602a2b62-5045-4a1c-81a6-77258e30e0c1','Legacy done task',NULL,'c86826fb-6694-446d-bc32-b49d95863c8b','low','done',NULL,NULL,NULL,'none',NULL,1793006750400,1793006750400,2,'{}',0,NULL);
CREATE INDEX tasks_status_due ON tasks(status, due_at);
CREATE INDEX tasks_remind ON tasks(status, remind_at, remind_fired_at);
PRAGMA user_version=7;
