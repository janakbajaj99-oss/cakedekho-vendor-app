import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import morgan from 'morgan';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { Pool } = pg;
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(morgan('dev'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', sameSite: 'lax' }
}));

const PORT = Number(process.env.PORT || 3000);
const MEMBERSHIP_FEE = Number(process.env.MEMBERSHIP_FEE || 499);
const COMMISSION = Number(process.env.MARKETPLACE_COMMISSION_PERCENT || 15);

async function q(text, params=[]) { return pool.query(text, params); }

async function initDb() {
  await q(`
    create table if not exists sellers(
      id serial primary key,
      business_name text not null,
      slug text unique not null,
      owner_name text not null,
      email text unique not null,
      phone text not null,
      password_hash text not null,
      area text,
      status text not null default 'PENDING',
      membership_status text not null default 'INACTIVE',
      membership_started_at timestamptz,
      membership_expires_at timestamptz,
      created_at timestamptz not null default now()
    );
    create table if not exists products(
      id serial primary key,
      seller_id integer not null references sellers(id) on delete cascade,
      shopify_product_id text unique,
      shopify_variant_id text,
      title text not null,
      description text,
      category text,
      price numeric(10,2) not null,
      eggless boolean not null default false,
      lead_time_hours integer not null default 24,
      status text not null default 'DRAFT',
      created_at timestamptz not null default now()
    );
    create table if not exists delivery_areas(
      id serial primary key,
      seller_id integer not null references sellers(id) on delete cascade,
      area_name text not null,
      pincode text,
      delivery_fee numeric(10,2) not null default 0,
      minimum_order numeric(10,2) not null default 0,
      same_day_cutoff text,
      active boolean not null default true
    );
    create table if not exists marketplace_orders(
      id serial primary key,
      shopify_order_id text unique not null,
      shopify_order_number text,
      customer_name text,
      customer_phone text,
      delivery_address text,
      gross_total numeric(10,2) not null default 0,
      created_at timestamptz not null default now()
    );
    create table if not exists order_lines(
      id serial primary key,
      marketplace_order_id integer not null references marketplace_orders(id) on delete cascade,
      seller_id integer not null references sellers(id),
      shopify_line_item_id text,
      product_title text not null,
      quantity integer not null,
      product_subtotal numeric(10,2) not null,
      delivery_fee numeric(10,2) not null default 0,
      commission_percent numeric(5,2) not null,
      commission_amount numeric(10,2) not null,
      seller_payable numeric(10,2) not null,
      payout_status text not null default 'PENDING',
      created_at timestamptz not null default now()
    );
    create table if not exists payouts(
      id serial primary key,
      seller_id integer not null references sellers(id),
      amount numeric(10,2) not null,
      status text not null default 'PAID',
      reference text,
      paid_at timestamptz default now(),
      created_at timestamptz not null default now()
    );
  `);
}

const css = `
:root{--pink:#ff4f8b;--ink:#281923;--muted:#735f69;--cream:#fff9f6;--border:#f0dfe5;--shadow:0 16px 40px rgba(70,30,48,.10)}
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial;background:var(--cream);color:var(--ink)}a{text-decoration:none;color:inherit}
.wrap{max-width:1120px;margin:auto;padding:0 22px}.top{background:#fff;border-bottom:1px solid var(--border)}.row{display:flex;gap:14px;align-items:center;justify-content:space-between}.top .row{min-height:68px}
.brand{font-size:28px;font-weight:1000;letter-spacing:-1.3px}.brand span{color:var(--pink)}nav{display:flex;gap:18px;font-weight:750}
.btn{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border);border-radius:13px;padding:12px 18px;font-weight:900;cursor:pointer;background:#fff}
.btn-primary{background:var(--pink);color:#fff;border-color:var(--pink)}.btn-dark{background:var(--ink);color:#fff;border-color:var(--ink)}.btn-sm{padding:8px 12px;border-radius:10px;font-size:13px}
main{padding:38px 0 70px}.hero{padding:40px;border-radius:28px;background:linear-gradient(135deg,#fff,#ffe9f0);box-shadow:var(--shadow);border:1px solid var(--border)}
h1{font-size:44px;line-height:1.04;margin:0 0 12px;letter-spacing:-2px}.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:18px}
.card{background:#fff;border:1px solid var(--border);border-radius:20px;padding:20px;box-shadow:var(--shadow)}.metric{font-size:30px;font-weight:1000}.label{font-size:13px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.06em}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:18px;overflow:hidden;border:1px solid var(--border)}th,td{padding:14px;text-align:left;border-bottom:1px solid var(--border);font-size:14px}th{background:#fff3f7;font-size:12px;text-transform:uppercase}
input,select,textarea{width:100%;padding:12px 13px;border:1px solid var(--border);border-radius:12px;background:#fff;font:inherit}textarea{min-height:110px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.field label{display:block;font-weight:800;margin:0 0 7px;font-size:14px}.stack{display:grid;gap:14px}
.notice{padding:14px 16px;border-radius:14px;background:#fff3f7;border:1px solid #ffd4e2}.pill{display:inline-block;padding:6px 10px;border-radius:999px;background:#fff1f6;border:1px solid #ffd6e3;font-size:12px;font-weight:900}
@media(max-width:800px){.grid,.form-grid{grid-template-columns:1fr}h1{font-size:34px}nav{display:none}.hero{padding:24px}}
`;

function page(title, body, nav='') {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — CakeDekho</title><style>${css}</style></head>
  <body><header class="top"><div class="wrap row"><a href="/" class="brand">Cake<span>Dekho</span></a>${nav}</div></header><main><div class="wrap">${body}</div></main></body></html>`;
}

function sellerNav(){return `<nav><a href="/seller">Dashboard</a><a href="/seller/products">Products</a><a href="/seller/delivery">Delivery</a><a href="/seller/orders">Orders</a><a href="/seller/earnings">Earnings</a><a href="/seller/logout">Logout</a></nav>`}
function adminNav(){return `<nav><a href="/admin">Dashboard</a><a href="/admin/sellers">Sellers</a><a href="/admin/payouts">Payouts</a><a href="/admin/logout">Logout</a></nav>`}

function tokenFor(id){ return jwt.sign({sellerId:id}, process.env.SESSION_SECRET, {expiresIn:'7d'}); }
function requireSeller(req,res,next){ try{const p=jwt.verify(req.cookies.cd_seller,process.env.SESSION_SECRET);req.sellerId=p.sellerId;next()}catch{res.redirect('/seller/login')} }
function requireAdmin(req,res,next){ if(req.session?.isAdmin) return next(); res.redirect('/admin/login'); }

async function shopifyGraphQL(query, variables={}) {
  const shop = process.env.SHOPIFY_STORE_DOMAIN, token = process.env.SHOPIFY_ACCESS_TOKEN;
  if(!shop || !token) throw new Error('Shopify not connected yet');
  const r = await fetch(`https://${shop}/admin/api/2026-10/graphql.json`,{
    method:'POST',
    headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},
    body:JSON.stringify({query,variables})
  });
  const j = await r.json();
  if(!r.ok || j.errors) throw new Error(JSON.stringify(j.errors||j));
  return j.data;
}

async function createShopifyProduct({title,description,price,vendorName}) {
  const m1=`mutation ProductCreate($product: ProductCreateInput!){productCreate(product:$product){product{id title} userErrors{field message}}}`;
  const d1=await shopifyGraphQL(m1,{product:{title,descriptionHtml:description||'',vendor:vendorName,status:"ACTIVE"}});
  if(d1.productCreate.userErrors?.length) throw new Error(d1.productCreate.userErrors.map(x=>x.message).join(', '));
  const productId=d1.productCreate.product.id;
  const m2=`mutation ProductVariantsCreate($productId: ID!, $variants:[ProductVariantsBulkInput!]!){productVariantsBulkCreate(productId:$productId,variants:$variants){productVariants{id price} userErrors{field message}}}`;
  const d2=await shopifyGraphQL(m2,{productId,variants:[{price:String(price)}]});
  if(d2.productVariantsBulkCreate.userErrors?.length) throw new Error(d2.productVariantsBulkCreate.userErrors.map(x=>x.message).join(', '));
  return {productId,variantId:d2.productVariantsBulkCreate.productVariants?.[0]?.id||null};
}

app.get('/',(req,res)=>res.send(page('Vendor App',`<section class="hero"><div class="pill">Pune Home Baker Marketplace</div><h1>Sell more with CakeDekho.</h1><p class="muted">₹${MEMBERSHIP_FEE}/month marketing membership with storefront, online orders, delivery controls and payout tracking.</p><div style="display:flex;gap:10px;margin-top:20px"><a class="btn btn-primary" href="/seller/register">Join as a Baker</a><a class="btn" href="/seller/login">Seller Login</a></div></section>`)));

app.get('/seller/register',(req,res)=>res.send(page('Join as a Baker',`<div class="card"><h1 style="font-size:34px">Join CakeDekho</h1><p class="muted">₹${MEMBERSHIP_FEE}/month marketing membership. Pune only.</p><form method="post" class="stack"><div class="form-grid"><div class="field"><label>Business name</label><input name="businessName" required></div><div class="field"><label>Owner name</label><input name="ownerName" required></div><div class="field"><label>Email</label><input name="email" type="email" required></div><div class="field"><label>Phone</label><input name="phone" required></div><div class="field"><label>Area</label><input name="area"></div><div class="field"><label>Password</label><input name="password" type="password" required></div></div><button class="btn btn-primary">Create account</button></form></div>`)));
app.post('/seller/register',async(req,res)=>{
  try{
    const {businessName,ownerName,email,phone,area,password}=req.body;
    let slug=(businessName||'seller').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'seller';
    const base=slug; let i=1;
    while((await q('select id from sellers where slug=$1',[slug])).rowCount) slug=`${base}-${i++}`;
    const hash=await bcrypt.hash(password,10);
    const r=await q(`insert into sellers(business_name,slug,owner_name,email,phone,password_hash,area) values($1,$2,$3,$4,$5,$6,$7) returning id`,[businessName,slug,ownerName,email,phone,hash,area||null]);
    res.cookie('cd_seller',tokenFor(r.rows[0].id),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production'});res.redirect('/seller');
  }catch(e){res.status(400).send(page('Error',`<div class="notice">Could not register. ${e.message}</div>`))}
});

app.get('/seller/login',(req,res)=>res.send(page('Seller Login',`<div class="card" style="max-width:520px;margin:auto"><h1 style="font-size:34px">Seller Login</h1><form method="post" class="stack"><div class="field"><label>Email</label><input name="email" type="email" required></div><div class="field"><label>Password</label><input name="password" type="password" required></div><button class="btn btn-primary">Login</button></form></div>`)));
app.post('/seller/login',async(req,res)=>{const r=await q('select * from sellers where email=$1',[req.body.email]);const s=r.rows[0];if(!s||!(await bcrypt.compare(req.body.password,s.password_hash)))return res.status(401).send(page('Login failed','<div class="notice">Invalid email or password.</div>'));res.cookie('cd_seller',tokenFor(s.id),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production'});res.redirect('/seller')});
app.get('/seller/logout',(req,res)=>{res.clearCookie('cd_seller');res.redirect('/seller/login')});

app.get('/seller',requireSeller,async(req,res)=>{
  const s=(await q('select * from sellers where id=$1',[req.sellerId])).rows[0];
  const lines=(await q('select * from order_lines where seller_id=$1',[req.sellerId])).rows;
  const gross=lines.reduce((a,l)=>a+Number(l.product_subtotal)+Number(l.delivery_fee),0), com=lines.reduce((a,l)=>a+Number(l.commission_amount),0), pending=lines.filter(l=>l.payout_status==='PENDING').reduce((a,l)=>a+Number(l.seller_payable),0);
  res.send(page('Seller Dashboard',`<div class="row"><div><div class="pill">${s.status}</div><h1>${s.business_name}</h1><p class="muted">Marketing membership: ${s.membership_status}</p></div><a class="btn btn-primary" href="/seller/products/new">Add Product</a></div><div class="grid"><div class="card"><div class="label">Gross customer value</div><div class="metric">₹${gross.toFixed(0)}</div></div><div class="card"><div class="label">CakeDekho commission</div><div class="metric">₹${com.toFixed(0)}</div></div><div class="card"><div class="label">Pending payout</div><div class="metric">₹${pending.toFixed(0)}</div></div></div><div class="card" style="margin-top:18px"><h2>₹${MEMBERSHIP_FEE}/month Marketing Membership</h2><p class="muted">Storefront, listings, online order collection, marketplace marketing support, delivery controls, earnings and payout tracking.</p></div>`,sellerNav()));
});

app.get('/seller/products',requireSeller,async(req,res)=>{const rows=(await q('select * from products where seller_id=$1 order by created_at desc',[req.sellerId])).rows;res.send(page('Products',`<div class="row"><h1>Products</h1><a class="btn btn-primary" href="/seller/products/new">Add Product</a></div><table><thead><tr><th>Product</th><th>Price</th><th>Eggless</th><th>Status</th><th>Shopify</th></tr></thead><tbody>${rows.map(p=>`<tr><td>${p.title}</td><td>₹${Number(p.price).toFixed(0)}</td><td>${p.eggless?'Yes':'No'}</td><td>${p.status}</td><td>${p.shopify_product_id?'Synced':'Not synced'}</td></tr>`).join('')||'<tr><td colspan="5">No products yet.</td></tr>'}</tbody></table>`,sellerNav()))});
app.get('/seller/products/new',requireSeller,(req,res)=>res.send(page('Add Product',`<div class="card"><h1 style="font-size:34px">Add Product</h1><form method="post" class="stack"><div class="form-grid"><div class="field"><label>Product title</label><input name="title" required></div><div class="field"><label>Price</label><input name="price" type="number" step="0.01" required></div><div class="field"><label>Category</label><select name="category"><option>Cakes</option><option>Brownies</option><option>Cupcakes</option><option>Cheesecakes</option><option>Desserts</option></select></div><div class="field"><label>Lead time hours</label><input name="leadTimeHours" type="number" value="24"></div></div><div class="field"><label>Description</label><textarea name="description"></textarea></div><label><input style="width:auto" type="checkbox" name="eggless" value="1"> Eggless</label><button class="btn btn-primary">Save & sync to Shopify</button></form></div>`,sellerNav())));
app.post('/seller/products/new',requireSeller,async(req,res)=>{
  const seller=(await q('select * from sellers where id=$1',[req.sellerId])).rows[0];
  let ids={};
  try{ids=await createShopifyProduct({title:req.body.title,description:req.body.description||'',price:req.body.price,vendorName:seller.business_name})}catch(e){console.error('Shopify sync failed:',e.message)}
  await q(`insert into products(seller_id,shopify_product_id,shopify_variant_id,title,description,category,price,eggless,lead_time_hours,status) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[req.sellerId,ids.productId||null,ids.variantId||null,req.body.title,req.body.description||'',req.body.category||'',req.body.price,req.body.eggless==='1',Number(req.body.leadTimeHours||24),ids.productId?'ACTIVE':'DRAFT']);
  res.redirect('/seller/products');
});

app.get('/seller/delivery',requireSeller,async(req,res)=>{const rows=(await q('select * from delivery_areas where seller_id=$1 order by id desc',[req.sellerId])).rows;res.send(page('Delivery Areas',`<h1>Pune Delivery Areas</h1><div class="card"><form method="post" class="form-grid"><div class="field"><label>Area name</label><input name="areaName" required></div><div class="field"><label>Pincode</label><input name="pincode"></div><div class="field"><label>Delivery fee</label><input name="deliveryFee" type="number" value="0"></div><div class="field"><label>Minimum order</label><input name="minimumOrder" type="number" value="0"></div><div class="field"><label>Same-day cutoff</label><input name="sameDayCutoff" placeholder="14:00"></div><div style="align-self:end"><button class="btn btn-primary">Add Area</button></div></form></div><table style="margin-top:18px"><thead><tr><th>Area</th><th>Pincode</th><th>Delivery</th><th>Minimum</th><th>Cutoff</th></tr></thead><tbody>${rows.map(a=>`<tr><td>${a.area_name}</td><td>${a.pincode||'-'}</td><td>₹${Number(a.delivery_fee).toFixed(0)}</td><td>₹${Number(a.minimum_order).toFixed(0)}</td><td>${a.same_day_cutoff||'-'}</td></tr>`).join('')||'<tr><td colspan="5">No areas yet.</td></tr>'}</tbody></table>`,sellerNav()))});
app.post('/seller/delivery',requireSeller,async(req,res)=>{await q(`insert into delivery_areas(seller_id,area_name,pincode,delivery_fee,minimum_order,same_day_cutoff) values($1,$2,$3,$4,$5,$6)`,[req.sellerId,req.body.areaName,req.body.pincode||null,req.body.deliveryFee||0,req.body.minimumOrder||0,req.body.sameDayCutoff||null]);res.redirect('/seller/delivery')});

app.get('/seller/orders',requireSeller,async(req,res)=>{const rows=(await q(`select ol.*,mo.shopify_order_number,mo.customer_name from order_lines ol join marketplace_orders mo on mo.id=ol.marketplace_order_id where ol.seller_id=$1 order by ol.created_at desc`,[req.sellerId])).rows;res.send(page('Orders',`<h1>Orders</h1><table><thead><tr><th>Order</th><th>Customer</th><th>Product</th><th>Value</th><th>Delivery</th><th>Your earning</th><th>Payout</th></tr></thead><tbody>${rows.map(l=>`<tr><td>#${l.shopify_order_number||''}</td><td>${l.customer_name||'-'}</td><td>${l.product_title} × ${l.quantity}</td><td>₹${Number(l.product_subtotal).toFixed(0)}</td><td>₹${Number(l.delivery_fee).toFixed(0)}</td><td>₹${Number(l.seller_payable).toFixed(0)}</td><td>${l.payout_status}</td></tr>`).join('')||'<tr><td colspan="7">No orders yet.</td></tr>'}</tbody></table>`,sellerNav()))});
app.get('/seller/earnings',requireSeller,async(req,res)=>{const rows=(await q('select * from order_lines where seller_id=$1',[req.sellerId])).rows;const product=rows.reduce((a,l)=>a+Number(l.product_subtotal),0),delivery=rows.reduce((a,l)=>a+Number(l.delivery_fee),0),commission=rows.reduce((a,l)=>a+Number(l.commission_amount),0),payable=rows.reduce((a,l)=>a+Number(l.seller_payable),0);res.send(page('Earnings',`<h1>Earnings</h1><div class="grid"><div class="card"><div class="label">Product sales</div><div class="metric">₹${product.toFixed(0)}</div></div><div class="card"><div class="label">Delivery collected</div><div class="metric">₹${delivery.toFixed(0)}</div></div><div class="card"><div class="label">Your total earning</div><div class="metric">₹${payable.toFixed(0)}</div></div></div><div class="card" style="margin-top:18px"><strong>CakeDekho commission:</strong> ₹${commission.toFixed(0)}</div>`,sellerNav()))});

app.get('/admin/login',(req,res)=>res.send(page('Admin Login',`<div class="card" style="max-width:520px;margin:auto"><h1 style="font-size:34px">CakeDekho Admin</h1><form method="post" class="stack"><div class="field"><label>Email</label><input name="email" type="email"></div><div class="field"><label>Password</label><input name="password" type="password"></div><button class="btn btn-dark">Login</button></form></div>`)));
app.post('/admin/login',(req,res)=>{if(req.body.email===process.env.ADMIN_EMAIL&&req.body.password===process.env.ADMIN_PASSWORD){req.session.isAdmin=true;return res.redirect('/admin')}res.status(401).send(page('Denied','<div class="notice">Invalid admin login.</div>'))});
app.get('/admin/logout',(req,res)=>req.session.destroy(()=>res.redirect('/admin/login')));

app.get('/admin',requireAdmin,async(req,res)=>{const sellerCount=Number((await q('select count(*) c from sellers')).rows[0].c),pending=Number((await q(`select count(*) c from sellers where status='PENDING'`)).rows[0].c),payable=Number((await q(`select coalesce(sum(seller_payable),0) s from order_lines where payout_status='PENDING'`)).rows[0].s);res.send(page('Admin',`<h1>CakeDekho Admin</h1><div class="grid"><div class="card"><div class="label">Sellers</div><div class="metric">${sellerCount}</div></div><div class="card"><div class="label">Pending approvals</div><div class="metric">${pending}</div></div><div class="card"><div class="label">Pending vendor payouts</div><div class="metric">₹${payable.toFixed(0)}</div></div></div>`,adminNav()))});
app.get('/admin/sellers',requireAdmin,async(req,res)=>{const rows=(await q('select * from sellers order by created_at desc')).rows;res.send(page('Sellers',`<h1>Sellers</h1><table><thead><tr><th>Business</th><th>Area</th><th>Status</th><th>Membership</th><th>Action</th></tr></thead><tbody>${rows.map(s=>`<tr><td>${s.business_name}<br><span class="muted">${s.email}</span></td><td>${s.area||'-'}</td><td>${s.status}</td><td>${s.membership_status}</td><td>${s.status==='PENDING'?`<form method="post" action="/admin/sellers/${s.id}/approve" style="display:inline"><button class="btn btn-sm btn-primary">Approve</button></form>`:''} ${s.membership_status!=='ACTIVE'?`<form method="post" action="/admin/sellers/${s.id}/activate-membership" style="display:inline"><button class="btn btn-sm">Activate ₹${MEMBERSHIP_FEE}</button></form>`:''}</td></tr>`).join('')||'<tr><td colspan="5">No sellers yet.</td></tr>'}</tbody></table>`,adminNav()))});
app.post('/admin/sellers/:id/approve',requireAdmin,async(req,res)=>{await q(`update sellers set status='APPROVED' where id=$1`,[Number(req.params.id)]);res.redirect('/admin/sellers')});
app.post('/admin/sellers/:id/activate-membership',requireAdmin,async(req,res)=>{await q(`update sellers set membership_status='ACTIVE',membership_started_at=now(),membership_expires_at=now()+interval '1 month' where id=$1`,[Number(req.params.id)]);res.redirect('/admin/sellers')});

app.get('/admin/payouts',requireAdmin,async(req,res)=>{const rows=(await q(`select s.id,s.business_name,count(ol.id) orders,coalesce(sum(ol.product_subtotal+ol.delivery_fee),0) gross,coalesce(sum(ol.commission_amount),0) commission,coalesce(sum(ol.seller_payable),0) payable from sellers s join order_lines ol on ol.seller_id=s.id and ol.payout_status='PENDING' group by s.id,s.business_name order by payable desc`)).rows;res.send(page('Payouts',`<h1>Vendor Payouts</h1><table><thead><tr><th>Seller</th><th>Orders</th><th>Gross</th><th>Commission</th><th>Payable</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.business_name}</td><td>${r.orders}</td><td>₹${Number(r.gross).toFixed(0)}</td><td>₹${Number(r.commission).toFixed(0)}</td><td><strong>₹${Number(r.payable).toFixed(0)}</strong></td><td><form method="post" action="/admin/payouts/${r.id}/mark-paid"><button class="btn btn-sm btn-dark">Mark Paid</button></form></td></tr>`).join('')||'<tr><td colspan="6">No pending payouts.</td></tr>'}</tbody></table>`,adminNav()))});
app.post('/admin/payouts/:sellerId/mark-paid',requireAdmin,async(req,res)=>{const id=Number(req.params.sellerId);const r=await q(`select coalesce(sum(seller_payable),0) amount from order_lines where seller_id=$1 and payout_status='PENDING'`,[id]);const amount=Number(r.rows[0].amount);if(amount>0){await q('insert into payouts(seller_id,amount) values($1,$2)',[id,amount]);await q(`update order_lines set payout_status='PAID' where seller_id=$1 and payout_status='PENDING'`,[id])}res.redirect('/admin/payouts')});

app.post('/webhooks/orders-create',async(req,res)=>{
  try{
    const o=req.body, oid=String(o.id);
    if((await q('select id from marketplace_orders where shopify_order_id=$1',[oid])).rowCount)return res.sendStatus(200);
    const or=await q(`insert into marketplace_orders(shopify_order_id,shopify_order_number,customer_name,customer_phone,delivery_address,gross_total) values($1,$2,$3,$4,$5,$6) returning id`,[
      oid,String(o.order_number||o.name||''),[o.customer?.first_name,o.customer?.last_name].filter(Boolean).join(' ')||o.billing_address?.name||null,o.phone||o.customer?.phone||null,[o.shipping_address?.address1,o.shipping_address?.address2,o.shipping_address?.city,o.shipping_address?.zip].filter(Boolean).join(', ')||null,o.total_price||0
    ]);
    for(const li of o.line_items||[]){
      const gid=li.variant_id?`gid://shopify/ProductVariant/${li.variant_id}`:null;
      if(!gid)continue;
      const pr=(await q('select * from products where shopify_variant_id=$1',[gid])).rows[0];
      if(!pr)continue;
      const subtotal=Number(li.price||0)*Number(li.quantity||1), commissionAmount=subtotal*(COMMISSION/100), sellerPayable=subtotal-commissionAmount;
      await q(`insert into order_lines(marketplace_order_id,seller_id,shopify_line_item_id,product_title,quantity,product_subtotal,delivery_fee,commission_percent,commission_amount,seller_payable) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[or.rows[0].id,pr.seller_id,String(li.id||''),li.title,Number(li.quantity||1),subtotal,0,COMMISSION,commissionAmount,sellerPayable]);
    }
    res.sendStatus(200);
  }catch(e){console.error(e);res.sendStatus(500)}
});

app.get('/health',(req,res)=>res.json({ok:true,app:'CakeDekho Vendor App'}));

initDb().then(()=>app.listen(PORT,()=>console.log(`CakeDekho Vendor App running on ${PORT}`))).catch(e=>{console.error('DB init failed',e);process.exit(1)});
