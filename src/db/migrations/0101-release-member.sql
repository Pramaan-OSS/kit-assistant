-- Choosing an owner address releases a member who never confirmed it: the account is deleted with its records. This
-- key had no ON DELETE rule, so the delete failed for an admin who decided a request and was later set back to member.
-- SET NULL, not CASCADE: the request belongs to the person who asked for it, and its status and job reference must
-- outlive whoever decided it, or a sent email would lose its record and a running job its status check.
ALTER TABLE assistant_approvals
  DROP CONSTRAINT assistant_approvals_decided_by_fkey,
  ADD CONSTRAINT assistant_approvals_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES app_users(id) ON DELETE SET NULL;
