const origin=process.env.GRAPHLENS_URL||'http://localhost:3000';
for(const extended of [false,true]){
 const response=await fetch(`${origin}/api/demo`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({extended})});
 if(!response.ok)throw new Error(await response.text());
 const run=await response.json();
 const report=await fetch(`${origin}/api/runs/${run.id}/coverage`).then(response=>response.json());
 console.log(`${report.run.name}: ${report.covered}/${report.total} (${report.percent}%). Proxy ${origin}/proxy/${run.id}`);
}
