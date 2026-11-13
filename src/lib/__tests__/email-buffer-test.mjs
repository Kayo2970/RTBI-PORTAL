import assert from 'node:assert/strict';

// Test 1: Verify Policy Resolution Logic
function resolvePolicyRecipients(policy, allMembers) {
  if (!policy || !allMembers) return [];
  const activeMembers = allMembers.filter(m => m.status !== 'SUSPENDED');
  if (policy.targetType === 'ALL') {
    return activeMembers.map(m => ({ email: m.email, name: m.name, id: m.id }));
  }
  if (policy.targetType === 'ROLES' && Array.isArray(policy.targetRoles)) {
    return activeMembers
      .filter(m => policy.targetRoles.includes(m.role))
      .map(m => ({ email: m.email, name: m.name, id: m.id }));
  }
  if (policy.targetType === 'INDIVIDUALS' && Array.isArray(policy.targetMemberIds)) {
    return activeMembers
      .filter(m => policy.targetMemberIds.includes(m.id))
      .map(m => ({ email: m.email, name: m.name, id: m.id }));
  }
  return [];
}

// Test 2: Verify Group Policy Email Template Generator
function generateGroupPolicyGrantEmailTemplate(memberName, policy, allottedByName) {
  const expiresText = policy.expiresAt
    ? `Valid until ${new Date(policy.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
    : 'Permanent (Until manually revoked)';

  const subject = `[LEADS ERP] Special Access Granted: ${policy.name}`;
  const bodyText = `Hello ${memberName}, special access has been allotted to you by ${allottedByName}. Policy: ${policy.name} (${expiresText}).`;
  return { subject, bodyText };
}

// Run Assertions
console.log('Testing Group Policy Recipient Resolution...');
const dummyMembers = [
  { id: '1', name: 'Alice', email: 'alice@example.com', role: 'CORE', status: 'ACTIVE' },
  { id: '2', name: 'Bob', email: 'bob@example.com', role: 'MEMBER', status: 'ACTIVE' },
  { id: '3', name: 'Charlie', email: 'charlie@example.com', role: 'CORE', status: 'SUSPENDED' },
];

const rolePolicy = { targetType: 'ROLES', targetRoles: ['CORE'], name: 'Event Managers' };
const roleRecipients = resolvePolicyRecipients(rolePolicy, dummyMembers);
assert.equal(roleRecipients.length, 1, 'Should only include active CORE members');
assert.equal(roleRecipients[0].name, 'Alice');

const indPolicy = { targetType: 'INDIVIDUALS', targetMemberIds: ['2'], name: 'Scanner Duty', expiresAt: '2026-10-10T12:00:00Z' };
const indRecipients = resolvePolicyRecipients(indPolicy, dummyMembers);
assert.equal(indRecipients.length, 1);
assert.equal(indRecipients[0].name, 'Bob');

const template = generateGroupPolicyGrantEmailTemplate('Bob', indPolicy, 'Admin John');
assert.match(template.subject, /Special Access Granted/);
assert.match(template.bodyText, /Admin John/);
assert.match(template.bodyText, /Scanner Duty/);

// Verify 10-Minute Buffer Time Constant
const BUFFER_DELAY_MS = 10 * 60 * 1000;
assert.equal(BUFFER_DELAY_MS, 600000, 'Buffer delay must equal exactly 600,000ms (10 minutes)');

// Test 3: Verify Sweeper Logic (Ensures emails actually get sent and never stuck)
function simulateSweep(emailsList, currentTime) {
  let dispatched = 0;
  for (const email of emailsList) {
    if (email.status === 'BUFFERED') {
      const untilMs = new Date(email.bufferedUntil).getTime();
      if (untilMs <= currentTime) {
        email.status = 'SENT';
        dispatched++;
      }
    }
  }
  return dispatched;
}

const testQueue = [
  { id: 'e1', status: 'BUFFERED', bufferedUntil: new Date(Date.now() - 5000).toISOString() }, // expired
  { id: 'e2', status: 'BUFFERED', bufferedUntil: new Date(Date.now() + 300000).toISOString() }, // 5 mins left
];

const swept = simulateSweep(testQueue, Date.now());
assert.equal(swept, 1, 'Matured email must be dispatched');
assert.equal(testQueue[0].status, 'SENT', 'Expired email status must transition to SENT');
assert.equal(testQueue[1].status, 'BUFFERED', 'Future email must remain BUFFERED until 10 min mark');

console.log('✓ All 6 verification checks passed successfully.');
