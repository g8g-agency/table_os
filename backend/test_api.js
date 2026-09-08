async function run() {
  const payload = {
    mutation_id: 'identify_customer',
    payload: {
      tenantId: '11111111-1111-1111-1111-111111111111',
      phoneNumber: '9508217664',
      name: 'Test User'
    }
  };

  try {
    const res = await fetch('http://localhost:3001/api/v1/customer/identify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    console.log("STATUS:", res.status);
    console.log("RESPONSE:", JSON.stringify(data, null, 2));
  } catch(e) {
    console.error(e);
  }
}
run();
