/**
 * SMTP_SECURE: how the value and the port decide whether the connection starts with TLS already in place.
 * Run: npx tsx scripts/e2e/tools/smtp-secure.test.mts
 */
import { smtpSecure } from '../../../src/lib/email-service';

let pass = 0, fail = 0;
const ok = (cond: boolean, name: string) => { if (cond) { pass++; console.log('PASS ', name); } else { fail++; console.log('FAIL ', name); } };

// implicit TLS: how providers write it
for (const v of ['true', 'TRUE', '1', 'yes', 'on', 'ssl', 'SSL', 'smtps']) ok(smtpSecure(v, 587) === true, `"${v}" means implicit TLS`);
// explicitly plain / STARTTLS
for (const v of ['false', '0', 'no', 'off', 'none', 'starttls', 'STARTTLS', 'plain']) ok(smtpSecure(v, 465) === false, `"${v}" means start plain and upgrade, even on port 465`);
// the port decides when the value says nothing definite
ok(smtpSecure(undefined, 465) === true, 'no value, port 465 -> implicit TLS');
ok(smtpSecure(undefined, 587) === false, 'no value, port 587 -> STARTTLS');
ok(smtpSecure('', 465) === true, 'empty value, port 465 -> implicit TLS');
// the reported failure: "tls" with port 465 used to be read as not secure and simply timed out
ok(smtpSecure('tls', 465) === true, '"tls" on port 465 -> implicit TLS (this combination used to fail to connect)');
ok(smtpSecure('tls', 587) === false, '"tls" on port 587 -> STARTTLS');
ok(smtpSecure('something-else', 465) === true, 'an unrecognised value falls back to the port');
ok(smtpSecure('something-else', 25) === false, 'an unrecognised value on port 25 -> plain');

console.log(`\nRESULT ${JSON.stringify({ pass, fail })}`);
process.exit(fail ? 1 : 0);
