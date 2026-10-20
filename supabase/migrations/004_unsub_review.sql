-- New unsubscribes wait for a team decision: confirm "everywhere" or narrow to "leave the group".
alter table suppressions add column if not exists reviewed_at timestamptz;
alter table suppressions add column if not exists reviewed_by text;
