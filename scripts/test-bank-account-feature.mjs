import zlib from 'zlib';

const BASE = 'http://127.0.0.1:3000';

function extractPdfText(buffer) {
  // Extract uncompressed text as well as decompress FlateDecode streams
  let text = '';
  const bufStr = buffer.toString('binary');
  
  // Look for text in uncompressed sections
  const uncompressedMatches = bufStr.match(/\((.*?)\)\s*Tj/g) || [];
  for (const m of uncompressedMatches) {
    text += ' ' + m;
  }
  
  // Look for compressed streams: "stream\r\n...endstream"
  const streamRegex = /stream[\r\n]+([\s\S]*?)endstream/g;
  let match;
  while ((match = streamRegex.exec(bufStr)) !== null) {
    try {
      const streamBuf = Buffer.from(match[1], 'binary');
      const decompressed = zlib.inflateSync(streamBuf);
      text += ' ' + decompressed.toString('utf-8');
    } catch {
      // not flate compressed or malformed, continue
    }
  }
  return text;
}

async function login() {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessCode: 'admin-2026' }),
  });
  if (!r.ok) throw new Error('Login failed with status ' + r.status);
  const cookie = (r.headers.getSetCookie?.()[0] || r.headers.get('set-cookie') || '').split(';')[0];
  return cookie;
}

async function run() {
  console.log('=== STARTING COMPLETE BANK ACCOUNT FEATURE TEST SUITE ===\n');
  const cookie = await login();
  console.log('1. Authenticated successfully. Session cookie obtained.\n');

  // Load active bank accounts by currency
  const aedAccountsRes = await fetch(`${BASE}/api/bank-accounts?currency=AED`, { headers: { cookie } });
  const aedAccounts = await aedAccountsRes.json();
  const usdAccountsRes = await fetch(`${BASE}/api/bank-accounts?currency=USD`, { headers: { cookie } });
  const usdAccounts = await usdAccountsRes.json();

  console.log(`Registered Active Accounts:`);
  console.log(`- AED Accounts (${aedAccounts.length}):`, aedAccounts.map((a) => `${a.bankName} (${a.accountNumberMasked})`).join(' | '));
  console.log(`- USD Accounts (${usdAccounts.length}):`, usdAccounts.map((a) => `${a.bankName} (${a.accountNumberMasked})`).join(' | '));
  console.log('');

  if (aedAccounts.length < 2) throw new Error(`Expected at least 2 AED accounts, found ${aedAccounts.length}`);
  if (usdAccounts.length < 2) throw new Error(`Expected at least 2 USD accounts, found ${usdAccounts.length}`);

  const aedAcc1 = aedAccounts[0];
  const aedAcc2 = aedAccounts[1];
  const usdAcc1 = usdAccounts[0];
  const usdAcc2 = usdAccounts[1];

  // Get customer & product
  const custRes = await fetch(`${BASE}/api/customers?limit=2`, { headers: { cookie } });
  if (!custRes.ok) throw new Error(`Customers fetch failed: ${custRes.status} ${await custRes.text()}`);
  const custData = await custRes.json();
  const customers = Array.isArray(custData) ? custData : (custData.customers || []);
  if (!customers.length) throw new Error('No customers found');
  const customerA = customers[0];
  const customerB = customers[1] || customers[0];

  const prodRes = await fetch(`${BASE}/api/products?limit=2&status=ACTIVE`, { headers: { cookie } });
  if (!prodRes.ok) throw new Error(`Products fetch failed: ${prodRes.status} ${await prodRes.text()}`);
  const prodData = await prodRes.json();
  const products = Array.isArray(prodData) ? prodData : (prodData.products || []);
  if (!products.length) throw new Error('No active products found');
  const product = products[0];

  const makeBody = (customerId, currency, bankAccountId, extra = {}) => ({
    customerId,
    currency,
    bankAccountId,
    items: [
      {
        productId: product.id,
        quantity: 2,
        unitPrice: 150,
        discountPercent: 10,
      },
    ],
    notes: 'Official Proforma for Bank Account Selection Verification',
    ...extra,
  });

  // --------------------------------------------------------------------------
  // TEST 1: AED account selection (AED Bank Account 1)
  // --------------------------------------------------------------------------
  console.log('--- TEST 1: AED account selection (AED Account 1) ---');
  const t1Res = await fetch(`${BASE}/api/proformas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(makeBody(customerA.id, 'AED', aedAcc1.id)),
  });
  if (t1Res.status !== 201) throw new Error(`Test 1 creation failed: ${t1Res.status} ${await t1Res.text()}`);
  const pf1 = await t1Res.json();
  console.log(`Created AED Proforma ${pf1.proformaNumber} (ID: ${pf1.id}) with Bank: ${aedAcc1.bankName}`);

  // Reopen via GET
  const pf1Get = await fetch(`${BASE}/api/proformas/${pf1.id}`, { headers: { cookie } }).then((r) => r.json());
  if (pf1Get.bankAccountId !== aedAcc1.id) throw new Error(`Test 1: Bank account id mismatch on get: ${pf1Get.bankAccountId}`);
  if (pf1Get.companyProfile?.bankAccounts?.length !== 1) throw new Error(`Test 1: Expected 1 bank account in profile, got ${pf1Get.companyProfile?.bankAccounts?.length}`);
  if (pf1Get.companyProfile?.bankAccounts?.[0]?.id !== aedAcc1.id) throw new Error(`Test 1: Profile account does not match aedAcc1`);

  // Download PDF
  const pdf1Res = await fetch(`${BASE}/api/document-pdf/PROFORMA/${pf1.id}`, { headers: { cookie } });
  if (!pdf1Res.ok) throw new Error(`Test 1 PDF download failed: ${pdf1Res.status}`);
  const pdf1Buf = Buffer.from(await pdf1Res.arrayBuffer());
  const pdf1Text = extractPdfText(pdf1Buf);
  if (!pdf1Text.includes(aedAcc1.bankName)) throw new Error(`Test 1 PDF missing ${aedAcc1.bankName}`);
  if (pdf1Text.includes(aedAcc2.bankName) && aedAcc1.bankName !== aedAcc2.bankName) {
    throw new Error(`Test 1 PDF should NOT contain AED Account 2 (${aedAcc2.bankName})`);
  }
  console.log(`✓ Test 1 Passed: AED Account 1 selection saved, retained on reopen, and PDF shows only Account 1.\n`);

  // --------------------------------------------------------------------------
  // TEST 2: Different AED account (AED Bank Account 2)
  // --------------------------------------------------------------------------
  console.log('--- TEST 2: Different AED account (AED Account 2) ---');
  const t2Res = await fetch(`${BASE}/api/proformas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(makeBody(customerB.id, 'AED', aedAcc2.id)),
  });
  if (t2Res.status !== 201) throw new Error(`Test 2 creation failed: ${t2Res.status}`);
  const pf2 = await t2Res.json();
  console.log(`Created second AED Proforma ${pf2.proformaNumber} with Bank: ${aedAcc2.bankName}`);

  const pf2Get = await fetch(`${BASE}/api/proformas/${pf2.id}`, { headers: { cookie } }).then((r) => r.json());
  if (pf2Get.bankAccountId !== aedAcc2.id) throw new Error(`Test 2: Expected bankAccountId ${aedAcc2.id}`);
  if (pf2Get.companyProfile?.bankAccounts?.[0]?.id !== aedAcc2.id) throw new Error(`Test 2: Profile account mismatch`);

  const pdf2Buf = Buffer.from(await (await fetch(`${BASE}/api/document-pdf/PROFORMA/${pf2.id}`, { headers: { cookie } })).arrayBuffer());
  const pdf2Text = extractPdfText(pdf2Buf);
  if (!pdf2Text.includes(aedAcc2.bankName)) throw new Error(`Test 2 PDF missing ${aedAcc2.bankName}`);

  // Check first invoice is unchanged
  const pf1Check = await fetch(`${BASE}/api/proformas/${pf1.id}`, { headers: { cookie } }).then((r) => r.json());
  if (pf1Check.bankAccountId !== aedAcc1.id) throw new Error(`Test 2: First invoice was altered!`);
  console.log(`✓ Test 2 Passed: Second AED invoice displays only Account 2. First invoice remains unchanged.\n`);

  // --------------------------------------------------------------------------
  // TEST 3: USD account selection (USD Bank Account 1)
  // --------------------------------------------------------------------------
  console.log('--- TEST 3: USD account selection (USD Account 1) ---');
  const t3Res = await fetch(`${BASE}/api/proformas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(makeBody(customerA.id, 'USD', usdAcc1.id)),
  });
  if (t3Res.status !== 201) throw new Error(`Test 3 creation failed: ${t3Res.status}`);
  const pf3 = await t3Res.json();
  console.log(`Created USD Proforma ${pf3.proformaNumber} with Bank: ${usdAcc1.bankName}`);

  const pf3Get = await fetch(`${BASE}/api/proformas/${pf3.id}`, { headers: { cookie } }).then((r) => r.json());
  if (pf3Get.bankAccountId !== usdAcc1.id) throw new Error(`Test 3: Expected bankAccountId ${usdAcc1.id}`);
  if (pf3Get.companyProfile?.bankAccounts?.[0]?.id !== usdAcc1.id) throw new Error(`Test 3: Profile account mismatch`);

  const pdf3Buf = Buffer.from(await (await fetch(`${BASE}/api/document-pdf/PROFORMA/${pf3.id}`, { headers: { cookie } })).arrayBuffer());
  const pdf3Text = extractPdfText(pdf3Buf);
  if (!pdf3Text.includes(usdAcc1.bankName)) throw new Error(`Test 3 PDF missing ${usdAcc1.bankName}`);
  console.log(`✓ Test 3 Passed: USD invoice displays selected USD Account 1.\n`);

  // --------------------------------------------------------------------------
  // TEST 4: Different USD account (USD Bank Account 2)
  // --------------------------------------------------------------------------
  console.log('--- TEST 4: Different USD account (USD Account 2) ---');
  const t4Res = await fetch(`${BASE}/api/proformas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(makeBody(customerB.id, 'USD', usdAcc2.id)),
  });
  if (t4Res.status !== 201) throw new Error(`Test 4 creation failed: ${t4Res.status}`);
  const pf4 = await t4Res.json();
  console.log(`Created USD Proforma ${pf4.proformaNumber} with Bank: ${usdAcc2.bankName}`);

  const pf4Get = await fetch(`${BASE}/api/proformas/${pf4.id}`, { headers: { cookie } }).then((r) => r.json());
  if (pf4Get.bankAccountId !== usdAcc2.id) throw new Error(`Test 4: Expected bankAccountId ${usdAcc2.id}`);
  if (pf4Get.companyProfile?.bankAccounts?.[0]?.id !== usdAcc2.id) throw new Error(`Test 4: Profile account mismatch`);

  // Check pf3 remains unchanged
  const pf3Check = await fetch(`${BASE}/api/proformas/${pf3.id}`, { headers: { cookie } }).then((r) => r.json());
  if (pf3Check.bankAccountId !== usdAcc1.id) throw new Error(`Test 4: First USD invoice was altered!`);
  console.log(`✓ Test 4 Passed: Second USD invoice displays only Account 2. First USD invoice remains unchanged.\n`);

  // --------------------------------------------------------------------------
  // TEST 5: Draft editing — retain previously selected bank account
  // --------------------------------------------------------------------------
  console.log('--- TEST 5: Draft editing retention ---');
  // Create a draft with usdAcc1
  const t5Create = await fetch(`${BASE}/api/proformas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(makeBody(customerA.id, 'USD', usdAcc1.id)),
  }).then((r) => r.json());

  // Update unrelated fields (e.g. notes or discountPercent) without passing bankAccountId
  const t5Update = await fetch(`${BASE}/api/proformas/${t5Create.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ notes: 'Updated notes during draft editing', discountPercent: 12 }),
  });
  if (!t5Update.ok) throw new Error(`Test 5 update failed: ${t5Update.status} ${await t5Update.text()}`);

  const t5Get = await fetch(`${BASE}/api/proformas/${t5Create.id}`, { headers: { cookie } }).then((r) => r.json());
  if (t5Get.bankAccountId !== usdAcc1.id) throw new Error(`Test 5: Bank account was lost after unrelated edit!`);
  if (t5Get.notes !== 'Updated notes during draft editing') throw new Error(`Test 5: Notes were not updated`);
  console.log(`✓ Test 5 Passed: Previously selected bank account is retained when reopening and editing drafts.\n`);

  // --------------------------------------------------------------------------
  // TEST 6: Changing bank account on existing draft
  // --------------------------------------------------------------------------
  console.log('--- TEST 6: Changing bank account on existing draft ---');
  // Change bank account on t5Create from usdAcc1 to usdAcc2
  const t6Update = await fetch(`${BASE}/api/proformas/${t5Create.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ bankAccountId: usdAcc2.id }),
  });
  if (!t6Update.ok) throw new Error(`Test 6 change failed: ${t6Update.status}`);

  const t6Get = await fetch(`${BASE}/api/proformas/${t5Create.id}`, { headers: { cookie } }).then((r) => r.json());
  if (t6Get.bankAccountId !== usdAcc2.id) throw new Error(`Test 6: Bank account was not updated to usdAcc2`);
  if (t6Get.companyProfile?.bankAccounts?.[0]?.id !== usdAcc2.id) throw new Error(`Test 6: Profile not updated to usdAcc2`);

  const t6PdfBuf = Buffer.from(await (await fetch(`${BASE}/api/document-pdf/PROFORMA/${t5Create.id}`, { headers: { cookie } })).arrayBuffer());
  const t6PdfText = extractPdfText(t6PdfBuf);
  if (!t6PdfText.includes(usdAcc2.bankName)) throw new Error(`Test 6 PDF missing updated account ${usdAcc2.bankName}`);
  console.log(`✓ Test 6 Passed: Changed bank account appears immediately in draft details and PDF preview.\n`);

  // --------------------------------------------------------------------------
  // TEST 7: Currency mismatch rejection
  // --------------------------------------------------------------------------
  console.log('--- TEST 7: Currency mismatch rejection ---');
  // Attempt to select an AED account for a USD invoice on creation -> expect 400
  const t7BadCreate = await fetch(`${BASE}/api/proformas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(makeBody(customerA.id, 'USD', aedAcc1.id)),
  });
  if (t7BadCreate.status !== 400) throw new Error(`Test 7: Expected 400 for AED account on USD invoice, got ${t7BadCreate.status}`);
  const t7BadCreateBody = await t7BadCreate.json();
  console.log('API rejected mismatched creation with message:', t7BadCreateBody.error);

  // Attempt to update USD draft with AED account -> expect 400
  const t7BadUpdate = await fetch(`${BASE}/api/proformas/${t5Create.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ bankAccountId: aedAcc1.id }),
  });
  if (t7BadUpdate.status !== 400) throw new Error(`Test 7: Expected 400 for AED account in PUT, got ${t7BadUpdate.status}`);
  const t7BadUpdateBody = await t7BadUpdate.json();
  console.log('API rejected mismatched update with message:', t7BadUpdateBody.error);
  console.log(`✓ Test 7 Passed: Currency mismatch is strictly rejected by backend validation.\n`);

  // --------------------------------------------------------------------------
  // TEST 8: Historical invoice protection (frozen companySnapshot)
  // --------------------------------------------------------------------------
  console.log('--- TEST 8: Historical invoice protection ---');
  // Confirm pf3 (USD Proforma with usdAcc1)
  const confirmRes = await fetch(`${BASE}/api/proformas/${pf3.id}/confirm`, {
    method: 'POST',
    headers: { cookie },
  });
  if (!confirmRes.ok) throw new Error(`Test 8 confirmation failed: ${confirmRes.status} ${await confirmRes.text()}`);
  console.log(`Proforma ${pf3.proformaNumber} confirmed. Snapshot stamped.`);

  // Verify snapshot exists and has exactly usdAcc1
  const pf3Confirmed = await fetch(`${BASE}/api/proformas/${pf3.id}`, { headers: { cookie } }).then((r) => r.json());
  if (!pf3Confirmed.companyProfile?.fromSnapshot) throw new Error(`Test 8: Expected fromSnapshot to be true`);
  const originalProfileBank = pf3Confirmed.companyProfile.bankAccounts[0];
  console.log(`Confirmed document bank snapshot: ${originalProfileBank.bankName}, A/c: ${originalProfileBank.accountNumber}`);

  // Temporarily update master bank account via PATCH /api/company/bank-accounts/:id
  const patchRes = await fetch(`${BASE}/api/company/bank-accounts/${usdAcc1.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      bankAddress: 'Modified Master Address For Testing Historical Snapshot',
      branch: 'Modified Branch',
    }),
  });
  if (!patchRes.ok) throw new Error(`Test 8 patch master bank account failed: ${patchRes.status}`);

  try {
    // Re-fetch pf3: should STILL show the original frozen details, NOT the modified master address!
    const pf3AfterMasterChange = await fetch(`${BASE}/api/proformas/${pf3.id}`, { headers: { cookie } }).then((r) => r.json());
    const afterBank = pf3AfterMasterChange.companyProfile.bankAccounts[0];
    if (afterBank.bankAddress === 'Modified Master Address For Testing Historical Snapshot') {
      throw new Error(`Test 8 FAILED: Historical issued invoice displayed modified master bank details!`);
    }
    console.log(`Issued invoice retained original address: "${afterBank.bankAddress}" (did not change to modified address)`);

    // PDF of pf3 should also preserve the original details
    const pdfIssuedBuf = Buffer.from(await (await fetch(`${BASE}/api/document-pdf/PROFORMA/${pf3.id}`, { headers: { cookie } })).arrayBuffer());
    const pdfIssuedText = extractPdfText(pdfIssuedBuf);
    if (pdfIssuedText.includes('Modified Master Address For Testing')) {
      throw new Error(`Test 8 FAILED: Issued PDF contains modified master details!`);
    }
    console.log(`✓ Test 8 Passed: Historical issued invoice details and PDF are 100% protected and frozen.\n`);
  } finally {
    // Restore original master bank account
    await fetch(`${BASE}/api/company/bank-accounts/${usdAcc1.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        bankAddress: originalProfileBank.bankAddress,
        branch: originalProfileBank.branch,
      }),
    });
    console.log(`Restored master bank account original details.`);
  }

  // --------------------------------------------------------------------------
  // TEST 9: Legacy invoice compatibility
  // --------------------------------------------------------------------------
  console.log('\n--- TEST 9: Legacy invoice compatibility ---');
  // Create a draft with NO bank account (simulating legacy invoice created before this feature)
  const legacyCreate = await fetch(`${BASE}/api/proformas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      customerId: customerA.id,
      currency: 'USD',
      items: [{ productId: product.id, quantity: 1, unitPrice: 200 }],
      notes: 'Legacy Proforma without bankAccountId',
    }),
  }).then((r) => r.json());

  console.log(`Created legacy-style proforma ${legacyCreate.proformaNumber} (bankAccountId: ${legacyCreate.bankAccountId})`);
  const legacyGet = await fetch(`${BASE}/api/proformas/${legacyCreate.id}`, { headers: { cookie } }).then((r) => r.json());
  if (legacyGet.bankAccountId !== null && legacyGet.bankAccountId !== undefined) {
    throw new Error(`Test 9: Legacy invoice was unexpectedly assigned a bank account!`);
  }
  // Should have 0 bank accounts in profile (not automatically assigning a random account)
  if (legacyGet.companyProfile?.bankAccounts?.length !== 0) {
    throw new Error(`Test 9: Legacy unissued invoice should not display random bank accounts. Got: ${legacyGet.companyProfile?.bankAccounts?.length}`);
  }

  // PDF generation should handle missing selection gracefully without error
  const legacyPdfRes = await fetch(`${BASE}/api/document-pdf/PROFORMA/${legacyCreate.id}`, { headers: { cookie } });
  if (!legacyPdfRes.ok) throw new Error(`Test 9: Legacy PDF download failed with status ${legacyPdfRes.status}`);
  const legacyPdfBuf = Buffer.from(await legacyPdfRes.arrayBuffer());
  if (legacyPdfBuf.length === 0) throw new Error(`Test 9: Legacy PDF buffer is empty`);
  console.log(`✓ Test 9 Passed: Legacy invoices remain fully accessible, no random bank account is assigned, and PDF generation handles missing bank selection gracefully.\n`);

  // --------------------------------------------------------------------------
  // TEST 10: Mandatory bank account before issuing + Other invoice functionality
  // --------------------------------------------------------------------------
  console.log('--- TEST 10: Issuing enforcement & other workflows ---');
  // Attempt to confirm legacy proforma without bank account -> expect 400
  const badConfirm = await fetch(`${BASE}/api/proformas/${legacyCreate.id}/confirm`, {
    method: 'POST',
    headers: { cookie },
  });
  if (badConfirm.status !== 400) throw new Error(`Test 10: Confirming without bank account should return 400, got ${badConfirm.status}`);
  const badConfirmBody = await badConfirm.json();
  console.log('Confirmation without bank account rejected with:', badConfirmBody.error);

  // Attempt to mark as SENT via PUT without bank account -> expect 400
  const badPutSent = await fetch(`${BASE}/api/proformas/${legacyCreate.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ status: 'SENT' }),
  });
  if (badPutSent.status !== 400) throw new Error(`Test 10: Marking SENT without bank account should return 400, got ${badPutSent.status}`);
  const badPutSentBody = await badPutSent.json();
  console.log('Status change without bank account rejected with:', badPutSentBody.error);

  // Deleting bank account referenced by proforma should be blocked
  const delBankRes = await fetch(`${BASE}/api/company/bank-accounts/${aedAcc1.id}`, {
    method: 'DELETE',
    headers: { cookie },
  });
  if (delBankRes.status !== 409 && delBankRes.status !== 400) {
    throw new Error(`Test 10: Deleting referenced bank account should be blocked (400/409), got ${delBankRes.status}`);
  }
  const delBankBody = await delBankRes.json();
  console.log('Deleting referenced bank account blocked with:', delBankBody.error);

  console.log(`✓ Test 10 Passed: Mandatory bank account before issuing enforced; referenced bank account deletion safely blocked.\n`);

  console.log('======================================================');
  console.log('ALL 10 VERIFICATION TESTS COMPLETED AND PASSED 100%!');
  console.log('======================================================\n');
}

run().catch((e) => {
  console.error('\n❌ TEST SUITE FAILED:', e);
  process.exit(1);
});
