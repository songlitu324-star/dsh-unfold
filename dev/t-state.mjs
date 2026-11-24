const base = process.argv[2] || 'http://127.0.0.1:60248';
const res = await fetch(`${base}/dsh-pet-7340/state`);
const text = await res.text();
console.log('status', res.status, 'len', text.length);
try {
  const json = JSON.parse(text);
  const keys = Object.keys(json);
  console.log('top keys', keys.slice(0, 12));
  const pets = json.pets || {};
  console.log('pets', Object.keys(pets).slice(0, 8));
  const first = pets[Object.keys(pets)[0]] || {};
  console.log('pet keys', Object.keys(first).slice(0, 20));
  console.log('sample', JSON.stringify(first).slice(0, 600));
} catch {
  console.log(text.slice(0, 400));
}
