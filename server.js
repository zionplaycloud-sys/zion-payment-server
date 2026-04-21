  import express from "express";
  import cors from "cors";
  import dotenv from "dotenv";
  import { createClient } from "@supabase/supabase-js";
  import { exec } from "child_process";
  import { v4 as uuidv4 } from "uuid";
  import fetch from "node-fetch";
  import bcrypt from "bcrypt";


  dotenv.config();
 const activeSessions = {};
  const app = express();
  app.use(cors());
  app.use(express.json());

  // ================= ENV =================
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
  );

 
  const streamBaseUrl = process.env.STREAM_BASE_URL || "";

  function sanitizeEmail(input) {
    const email = (input || "").toString().trim().toLowerCase();
    if (!email) return "";
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    return ok ? email : "";
  }

  function sanitizePhone(input) {
    const digits = (input || "").toString().replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) return "";
    return digits;
  }

  function makeCustomerId(username) {
    const base = (username || "")
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");

    const normalized = (base || "user").slice(0, 24);
    const suffix = Date.now().toString().slice(-6);
    return `cust_${normalized}_${suffix}`;
  }

  const SHOP_PLANS = [
    { id: "p100", amount: 100, hours: 1, cashBackPts: 10 },
    { id: "p199", amount: 199, hours: 3, cashBackPts: 19 },
    { id: "p499", amount: 499, hours: 8, cashBackPts: 49, featured: true },
    { id: "p999", amount: 999, hours: 20, cashBackPts: 99 },
    { id: "p2499", amount: 2499, hours: 60, cashBackPts: 249 }
  ];

  const POINTS_MARKUP_MULTIPLIER = 1.3; // +30% points cost

  function getPlanByAmount(rawAmount) {
    const amount = Number(String(rawAmount ?? "").replace(/[^\d.]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const rounded = Math.round(amount);
    return SHOP_PLANS.find((p) => p.amount === rounded) || null;
  }

  function pointsCostForPlan(plan) {
    return Math.ceil(plan.amount * POINTS_MARKUP_MULTIPLIER);
  }

  async function applyUserCredit(username, addHours = 0, addPts = 0) {
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("*")
      .eq("username", username)
      .maybeSingle();

    if (userErr || !user) {
      return { success: false, error: "User not found" };
    }

    const newHours = (user.hours || 0) + Number(addHours || 0);
    const newPts = (user.pts || 0) + Number(addPts || 0);

    const { error: updateError } = await supabase
      .from("users")
      .update({ hours: newHours, pts: newPts })
      .eq("username", username);

    if (updateError) {
      return { success: false, error: updateError.message || "Failed to update user" };
    }

    const { data: session } = await supabase
      .from("sessions")
      .select("*")
      .eq("username", username)
      .maybeSingle();

const currentTime = session ? Number(session.time_left) : 0;
const newTime = currentTime + Number(addHours || 0);

    const { error: sessionError } = await supabase
      .from("sessions")
      .upsert({
        username,
        time_left: newTime,
        updated_at: new Date()
      });

    if (sessionError) {
      return { success: false, error: sessionError.message || "Failed to update session" };
    }

    return { success: true, hours: newHours, pts: newPts, timeLeft: newTime };
  }

  async function generateUniqueReferralCode() {
    for (let i = 0; i < 20; i++) {
      const candidate = `zpc${Math.floor(100000 + Math.random() * 900000)}`;
      const { data: taken } = await supabase
        .from("users")
        .select("username")
        .eq("referral_code", candidate)
        .maybeSingle();
      if (!taken) {
        return candidate;
      }
    }
    return "";
  }

  function readPaymentContactFromUser(user) {
    if (!user) {
      return { email: "", phone: "" };
    }

    const email = sanitizeEmail(
      user.customer_email || user.payment_email || user.username || ""
    );
    const phone = sanitizePhone(
      user.customer_phone || user.payment_phone || user.phone || user.mobile || user.mobile_no || ""
    );

    return { email, phone };
  }

  async function savePaymentContactForUser(username, paymentEmail, paymentPhone) {
    const email = sanitizeEmail(paymentEmail);
    const phone = sanitizePhone(paymentPhone);

    if (!username || !email || !phone) {
      return { success: false, error: "Invalid payment contact data" };
    }

    const payloadOptions = [
      { customer_email: email, customer_phone: phone },
      { payment_email: email, payment_phone: phone },
      { customer_email: email, phone: phone },
      { payment_email: email, phone: phone }
    ];

    for (const payload of payloadOptions) {
      const { error } = await supabase
        .from("users")
        .update(payload)
        .eq("username", username);

      if (!error) {
        return { success: true, email, phone };
      }
    }

    return {
      success: false,
      error: "Could not save contact in users table. Add customer_email/customer_phone columns."
    };
  }

  // ================= ROOT =================
  app.get("/", (req, res) => {
    res.send("Server running 🚀");
  });

  // ================= SIGNUP =================
app.post("/signup", async (req, res) => {
  try {
    const { email, password, referralCode } = req.body;

    const { data: existing } = await supabase
      .from("users")
      .select("*")
      .eq("username", email)
      .maybeSingle();

    if (existing) return res.json({ success: false });

    const cleanReferralCode = (referralCode || "").toString().trim().toLowerCase();
    let referredBy = null;

    if (cleanReferralCode) {
      const { data: refUser } = await supabase
        .from("users")
        .select("username")
        .eq("referral_code", cleanReferralCode)
        .maybeSingle();

      if (!refUser) {
        return res.json({ success: false, error: "Invalid referral code" });
      }

      if (refUser.username === email) {
        return res.json({ success: false, error: "Cannot use own referral code" });
      }

      referredBy = refUser.username;
    }

    // 🔥 HASH PASSWORD
    const hashedPassword = await bcrypt.hash(password, 10);

    const ownReferralCode = await generateUniqueReferralCode();

    if (!ownReferralCode) {
      return res.json({ success: false, error: "Failed to generate referral code" });
    }

    const { error } = await supabase.from("users").insert({
      username: email,
      password: hashedPassword,
      hours: 0,
      pts: 0,
      referral_code: ownReferralCode,
      referred_by: referredBy
    });

    if (error) return res.json({ success: false, error: error.message || "Signup failed" });

    res.json({ success: true, referralCode: ownReferralCode });

  } catch (err) {
    res.json({ success: false, error: err?.message || "Signup failed" });
  }
});


// ================= LOGIN =================
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.json({ success: false, error: "Missing fields" });
    }

// ================= ADMIN LOGIN =================
const { data: admin } = await supabase
  .from("admin")
  .select("*")
  .eq("username", email)
  .maybeSingle();

if (admin) {
  const isMatch = await bcrypt.compare(password, admin.password);

  if (!isMatch) {
    return res.json({ success: false });
  }

  return res.json({
    success: true,
    hrs: admin.hours || 0,
    pts: admin.pts || 0,
    isAdmin: true
  });
}
// ================= USER LOGIN =================
const { data: user } = await supabase
  .from("users")
  .select("*")
  .eq("username", email)
  .maybeSingle();

if (!user) {
  return res.json({ success: false });
}

const isMatch = await bcrypt.compare(password, user.password);

if (!isMatch) {
  return res.json({ success: false });
}

if (!user.referral_code) {
  const generated = await generateUniqueReferralCode();
  if (generated) {
    await supabase
      .from("users")
      .update({ referral_code: generated })
      .eq("username", email);
    user.referral_code = generated;
  }
}

// 🔥 SESSION CHECK (MOVE HERE)
const { data: session } = await supabase
  .from("sessions")
  .select("*")
  .eq("username", email)
  .maybeSingle();

let currentTime = user.hours || 0;

if (session) {
  currentTime = session.time_left;
} else {
  await supabase.from("sessions").insert({
    username: email,
    time_left: user.hours || 0,
    updated_at: new Date()
  });

  currentTime = user.hours || 0;
}

return res.json({
  success: true,
  hrs: currentTime,
  pts: user.pts || 0,
  isAdmin: false,
  paymentEmail: readPaymentContactFromUser(user).email,
  paymentPhone: readPaymentContactFromUser(user).phone,
  referralCode: user.referral_code || "",
  referredBy: user.referred_by || ""
});
} catch (err) {
  console.log("LOGIN ERROR:", err);
  res.json({ success: false });
}
});

  app.post("/save-payment-contact", async (req, res) => {
    try {
      const { username, paymentEmail, paymentPhone } = req.body || {};

      if (!username) {
        return res.json({ success: false, error: "Username required" });
      }

      const saved = await savePaymentContactForUser(username, paymentEmail, paymentPhone);
      if (!saved.success) {
        return res.json(saved);
      }

      return res.json({
        success: true,
        paymentEmail: saved.email,
        paymentPhone: saved.phone
      });
    } catch (err) {
      console.log("SAVE PAYMENT CONTACT ERROR:", err);
      return res.json({ success: false, error: "Failed to save payment contact" });
    }
  });

  app.post("/buy-with-points", async (req, res) => {
    try {
      const { username, amount } = req.body || {};
      if (!username) {
        return res.json({ success: false, error: "Username required" });
      }

      const plan = getPlanByAmount(amount);
      if (!plan) {
        return res.json({ success: false, error: "Invalid plan amount" });
      }

      const { data: user } = await supabase
        .from("users")
        .select("*")
        .eq("username", username)
        .maybeSingle();

      if (!user) {
        return res.json({ success: false, error: "User not found" });
      }

      const requiredPoints = pointsCostForPlan(plan);
      const currentPoints = Number(user.pts || 0);
      if (currentPoints < requiredPoints) {
        return res.json({
          success: false,
          error: "Not enough points",
          requiredPoints,
          currentPoints
        });
      }

      const credit = await applyUserCredit(username, plan.hours, -requiredPoints);
      if (!credit.success) {
        return res.json({ success: false, error: credit.error || "Purchase failed" });
      }

      return res.json({
        success: true,
        mode: "points",
        planAmount: plan.amount,
        hoursAdded: plan.hours,
        pointsSpent: requiredPoints,
        pts: credit.pts,
        hrs: credit.hours,
        timeLeft: credit.timeLeft
      });
    } catch (err) {
      console.log("BUY WITH POINTS ERROR:", err);
      return res.json({ success: false, error: err?.message || "Purchase failed" });
    }
  });

// ================= ADMIN ADD =================
  app.post("/admin-add", async (req, res) => {
    try {
      const { email, hrs, pts } = req.body;

      const { data: user } = await supabase
        .from("users")
        .select("*")
        .eq("username", email)
        .maybeSingle();

      if (!user) return res.json({ success: false });

      await supabase
        .from("users")
        .update({
          hours: (user.hours || 0) + hrs,
          pts: (user.pts || 0) + pts
        })
        .eq("username", email);

      res.json({ success: true });

    } catch {
      res.json({ success: false });
    }
  });

  // ================= SYSTEM STATE =================

  // GET SYSTEM STATE
  app.get("/get-system-state", async (req, res) => {
    try {
      const { data } = await supabase.from("sessions").select("*");

      let state = {};

      data.forEach(row => {
        state[row.username] = {
          timeLeft: row.time_left
        };
      });

      res.json({ success: true, state });

    } catch {
      res.json({ success: false });
    }
  });

  // 🔥 FIXED UPDATE SYSTEM STATE
  app.post("/update-system-state", async (req, res) => {
    try {
      const state = req.body.state;

      // 🔥 Extract dynamic key
      const email = Object.keys(state)[0];
      const timeLeft = state[email].timeLeft;

      if (!email) {
        return res.json({ success: false });
      }

      await supabase
        .from("sessions")
        .upsert({
          username: email,
          time_left: timeLeft,
          updated_at: new Date()
        });

      console.log("Saved:", email, timeLeft);

      res.json({ success: true });

    } catch (err) {
      console.log("ERROR:", err);
      res.json({ success: false });
    }
  });

  // ================= WEBHOOK =================
app.post("/webhook", async (req, res) => {
  try {
    const data = req.body;

    console.log("🔥 Cashfree webhook received:");
    console.log(JSON.stringify(data, null, 2));

    const payment = data.data?.payment;
    const order = data.data?.order;

    // =========================
    // ✅ ONLY PROCESS SUCCESS
    // =========================
    if (payment?.payment_status !== "SUCCESS") {
      console.log("⚠️ Not a success payment");
      return res.sendStatus(200);
    }

    const orderId = order?.order_id;
    const amount = Number(order?.order_amount);
    const username = order?.order_tags?.username;

    if (!orderId || !username || !amount) {
      console.log("❌ Missing data");
      return res.sendStatus(400);
    }

    // =========================
    // 🚫 PREVENT DUPLICATE WEBHOOK
    // =========================
    const { data: existing } = await supabase
      .from("payments")
      .select("*")
      .eq("order_id", orderId)
      .maybeSingle();

    if (existing) {
      console.log("⚠️ Duplicate webhook ignored");
      return res.sendStatus(200);
    }

    // Save payment (mark processed)
    await supabase.from("payments").insert({
      order_id: orderId,
      username: username,
      amount: amount
    });

    const plan = getPlanByAmount(amount);

    if (!plan) {
      console.log("❌ Invalid plan");
      return res.sendStatus(400);
    }

    // =========================
    // 🔥 GET USER BEFORE CREDIT
    // =========================
    const { data: userBefore } = await supabase
      .from("users")
      .select("hours")
      .eq("username", username)
      .maybeSingle();

    // =========================
    // 🎯 FIRST PURCHASE CHECK
    // =========================
    const isFirstPurchase = !userBefore || Number(userBefore.hours || 0) === 0;

    console.log("🧠 First purchase check:", {
  userBefore,
  isFirstPurchase
});

    // =========================
    // 🎁 NEW USER BONUS (0.5 hr)
    // =========================
  const totalHours = plan.hours + (isFirstPurchase ? 0.5 : 0);

const buyerCredit = await applyUserCredit(
  username,
  totalHours,
  plan.cashBackPts
);

if (!buyerCredit.success) {
  console.log("❌ Buyer credit failed:", buyerCredit.error);
  return res.sendStatus(500);
}

    // =========================
    // 🎁 REFERRAL BONUS (POINTS ONLY)
    // =========================
    const { data: buyer } = await supabase
      .from("users")
      .select("referred_by")
      .eq("username", username)
      .maybeSingle();

    const referrer = buyer?.referred_by;

    if (referrer && isFirstPurchase) {
      const referralPts = Math.floor(plan.amount * 0.2);

      const referralCredit = await applyUserCredit(referrer, 0, referralPts);

      if (referralCredit.success) {
        console.log("🎁 Referral points applied:", referrer, referralPts);
      } else {
        console.log("⚠️ Referral failed:", referralCredit.error);
      }
    }

    // =========================
    // ✅ FINAL LOG
    // =========================
    console.log("🔥 SUCCESS:", username, {
      hours: plan.hours,
      cashbackPts: plan.cashBackPts
    });

    res.sendStatus(200);

  } catch (err) {
    console.log("❌ Webhook error:", err);
    res.sendStatus(500);
  }
});

 app.post("/create-order", async (req, res) => {
  try {
    const { amount, username, paymentEmail, paymentPhone } = req.body;
    const plan = getPlanByAmount(amount);
    const orderAmount = plan?.amount || Number.NaN;
    const loginEmail = sanitizeEmail(username);

    if (!username || !plan || !Number.isFinite(orderAmount) || orderAmount <= 0) {
      return res.json({
        success: false,
        error: "Invalid order payload",
        details: {
          usernamePresent: Boolean(username),
          amountRaw: amount,
          amountParsed: Number.isFinite(orderAmount) ? orderAmount : null
        }
      });
    }

    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("username", username)
      .maybeSingle();

    const storedContact = readPaymentContactFromUser(user);
    const requestedEmail = sanitizeEmail(paymentEmail);
    const requestedPhone = sanitizePhone(paymentPhone);

    // Save first-purchase contact when provided by client.
    if (requestedEmail && requestedPhone) {
      const saved = await savePaymentContactForUser(username, requestedEmail, requestedPhone);
      if (!saved.success) {
        return res.json(saved);
      }
    }

    const customerEmail = requestedEmail || storedContact.email || loginEmail;
    const customerPhone = requestedPhone || storedContact.phone;
    const customerId = makeCustomerId(username);

    if (!customerEmail) {
      return res.json({
        success: false,
        error: "Missing customer email",
        contactRequired: true
      });
    }

    if (!customerPhone) {
      return res.json({
        success: false,
        contactRequired: true,
        error: "CONTACT_REQUIRED"
      });
    }

    console.log("Creating order for:", customerEmail, orderAmount);

const orderId = "order_" + Date.now();

// 🔥 AUTO SWITCH (SANDBOX / PRODUCTION)
const CASHFREE_BASE_URL =
  process.env.CASHFREE_MODE === "sandbox"
    ? "https://sandbox.cashfree.com/pg"
    : "https://api.cashfree.com/pg";

console.log("🌐 Using Cashfree URL:", CASHFREE_BASE_URL);

const response = await fetch(`${CASHFREE_BASE_URL}/orders`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-version": "2022-09-01",
    "x-client-id": process.env.CASHFREE_APP_ID,
    "x-client-secret": process.env.CASHFREE_SECRET_KEY
  },
  body: JSON.stringify({
    order_id: orderId,
    order_amount: orderAmount,
    order_currency: "INR",
    order_tags: {
      username
    },
    customer_details: {
      customer_id: customerId,
      customer_email: customerEmail,
      customer_phone: customerPhone
    }
  })
});

const data = await response.json();

// 🔴 ERROR HANDLING
if (!response.ok) {
  console.log("❌ Cashfree error response:", data);
  return res.json({
    success: false,
    error: data?.message || data?.error?.message || "Cashfree order failed"
  });
}

// ✅ SUCCESS LOG
console.log("✅ Cashfree FULL response:", data);

res.json({
  success: true,
  payment_session_id: data.payment_session_id
});

  } catch (err) {
    console.log("CREATE ORDER ERROR:", err);
    res.json({ success: false });
  }
});

  // ================= ADMIN STATS =================
  app.get("/admin-stats", async (req, res) => {
    try {
      const { range } = req.query;

      // Get all users
      const { data: users } = await supabase.from("users").select("*");

      let totalRevenue = 0;
      let totalOrders = 0;
      let totalHours = 0;
      let totalPoints = 0;

      if (users) {
        users.forEach(user => {
          totalHours += user.hours || 0;
          totalPoints += user.pts || 0;
          totalOrders += 1;
          // Rough estimate: ₹100 per hour
          totalRevenue += (user.hours || 0) * 100;
        });
      }

      res.json({
        success: true,
        totalRevenue: totalRevenue,
        totalOrders: totalOrders,
        totalHours: Math.round(totalHours),
        totalPoints: totalPoints,
        range: range
      });

    } catch (err) {
      console.log("ADMIN STATS ERROR:", err);
      res.json({ success: false, error: err.message });
    }
  });

  // ================= LAUNCH EXE =================
  app.post("/launch-exe", async (req, res) => {
    try {
      const { path } = req.body;

      if (!path || typeof path !== "string" || path.length < 3) {
        return res.json({ success: false, error: "Invalid path" });
      }

      console.log("Launching:", path);

      exec(`cmd /c start "" "${path}"`, (error, stdout, stderr) => {
        if (error) {
          console.log("Launch error:", stderr);
          return res.json({ success: false, error: stderr });
        }
        res.json({ success: true, message: "Game launched" });
      });

    } catch (err) {
      console.log("LAUNCH EXE ERROR:", err);
      res.json({ success: false, error: err.message });
    }
  });
  // ================= launch-agent =================

app.post("/launch-agent", async (req, res) => {
  try {
    const agentBase = process.env.AGENT_URL;
    const { path, sessionId, windowName: requestedWindowName, game: requestedGameName } = req.body;

    if (!path || !sessionId) {
      console.log("❌ Missing path or sessionId");
      return res.json({ success: false });
    }

    console.log("🚀 Launch-agent request:", { path, sessionId });

    // 🔥 GET GAME FROM DB (to get window_name)
    const { data: game, error } = await supabase
      .from("games")
      .select("*")
      .eq("exe_path", path)
      .maybeSingle();

    if (error) {
      console.log("❌ DB error:", error);
      return res.json({ success: false });
    }

    if (!game) {
      console.log("⚠️ Game not found for path:", path);
    }

    const windowName =
      game?.window_name ||
      requestedWindowName ||
      requestedGameName ||
      "";

    console.log("🎯 Window target:", windowName);

    // ⚠️ Safety log (important for debugging)
    if (!windowName) {
      console.log("⚠️ window_name missing → may capture full screen");
    }

 // 🔥 SEND TO AGENT
const launchRes = await fetch(`${agentBase}/launch-agent`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    path,
    sessionId,
    windowName
  })
});

// 🔥 SAFE PARSE (IMPORTANT)
const text = await launchRes.text();

let data;

try {
  data = JSON.parse(text);
} catch (err) {
  console.log("❌ Agent returned NON-JSON:");
  console.log(text.slice(0, 200)); // log first part

  return res.json({
    success: false,
    error: "Agent unreachable (tunnel delay)"
  });
}

console.log("✅ Agent response:", data);

return res.json(data);

  } catch (err) {
    console.log("❌ LAUNCH AGENT ERROR:", err);
    return res.json({ success: false });
  }
});

  // ================= KILL PROCESS =================
  app.post("/kill-process", async (req, res) => {
    try {
      const { processName } = req.body;

      if (!processName) {
        return res.json({ success: false, error: "Process name required" });
      }

      // 🔥 WINDOWS: Kill process by name
      exec(`taskkill /IM ${processName}.exe /F`, (error, stdout, stderr) => {
        if (error) {
          console.log("Process kill message:", stderr);
          // Process might not be running, but we still consider it success
          return res.json({ success: true, message: "Kill signal sent" });
        }
        console.log("Process killed:", processName);
        res.json({ success: true, message: `${processName} killed` });
      });

    } catch (err) {
      console.log("KILL ERROR:", err);
      res.json({ success: false, error: err.message });
    }
  });

  // ================= START =================
  const PORT = process.env.PORT || 10000;

  app.listen(PORT, () => {
    console.log("Server running on port " + PORT);
  });
// ================= ASSIGN-PC =================
app.post("/assign-pc", async (req, res) => {
  try {
    const { username, game } = req.body;

    // ❌ REMOVE THIS (NOT USED ANYMORE)
    // const agentBase = process.env.AGENT_URL;

    // 🔁 Check if user already has PC
    const { data: existing } = await supabase
      .from("pcs")
      .select("*")
      .eq("current_user", username)
      .maybeSingle();

    // 🔥 ALWAYS CREATE NEW SESSION
    const sessionId = uuidv4();

    // 🔥 GET GAME DATA (IMPORTANT)
    const { data: gameData, error: gameError } = await supabase
      .from("games")
      .select("*")
      .eq("name", game)
      .single();

    if (gameError || !gameData) {
      console.log("❌ Game not found");
      return res.json({ success: false, error: "Game not found" });
    }

    const exePath = gameData.exe_path;
    const windowName = gameData.window_name;

    console.log("🎯 Game selected:", gameData.name);
    console.log("🎯 Window target:", windowName);

    // 🔥 EXISTING PC CASE
    if (existing) {
      activeSessions[sessionId] = {
        username,
        pc: existing.name
      };

      console.log("🎮 Session created (existing):", sessionId);

      // 🔥 SEND TO THAT SPECIFIC PC
      await fetch(`${existing.agent_url}/launch-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          path: exePath,
          sessionId,
          windowName
        })
      });

      return res.json({
        success: true,
        pc: existing.name,
        sessionId,
        streamBaseUrl
      });
    }

    // 🔍 Find free PC
    const { data: pcs } = await supabase
      .from("pcs")
      .select("*")
      .eq("status", "free")
      .limit(1);

    if (!pcs || pcs.length === 0) {
      return res.json({ success: false, error: "No PC available" });
    }

    const pc = pcs[0];

    // 🔒 Mark busy
    await supabase
      .from("pcs")
      .update({
        status: "busy",
        current_user: username
      })
      .eq("id", pc.id);

    console.log(`Assigned ${pc.name} to ${username}`);

    // 🔥 STORE SESSION
    activeSessions[sessionId] = {
      username,
      pc: pc.name
    };

    console.log("🎮 Session created:", sessionId);

    // 🔥 SEND TO CORRECT AGENT (THIS IS THE FIX)
    await fetch(`${pc.agent_url}/launch-agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        path: exePath,
        sessionId,
        windowName
      })
    });

    console.log("✅ Session sent to agent:", pc.agent_url);

    // ✅ FINAL RESPONSE (ONLY ONCE)
    res.json({
      success: true,
      pc: pc.name,
      sessionId,
      streamBaseUrl
    });

  } catch (err) {
    console.log("ASSIGN PC ERROR:", err);
    res.json({ success: false });
  }
});

  // ================= RELEASE PC =================
  app.post("/release-pc", async (req, res) => {
    try {
      const { username } = req.body;

      await supabase
        .from("pcs")
        .update({
          status: "free",
          current_user: null
        })
        .eq("current_user", username);

      res.json({ success: true });

    } catch (err) {
      console.log("RELEASE PC ERROR:", err);
      res.json({ success: false });
    }
  });
  // ================= GAMES SYSTEM =================

  // SAVE GAMES
  app.post("/save-games", async (req, res) => {
    try {
      const { games } = req.body;

      // 🔥 Delete old games
      await supabase.from("games").delete().neq("id", "");

      // 🔥 Insert new games
      const { error } = await supabase.from("games").insert(
       games.map(g => ({
  name: g.name,
  img: g.img,
  desc: g.desc,
  exe_path: g.exePath,
  window_name: g.windowName || g.name   // 🔥 IMPORTANT
}))
      );

      if (error) {
        console.log("SAVE GAMES ERROR:", error);
        return res.json({ success: false });
      }

      res.json({ success: true });

    } catch (err) {
      console.log("SAVE GAMES ERROR:", err);
      res.json({ success: false });
    }
  });


  // GET GAMES
  app.get("/get-games", async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("games")
        .select("*");

      if (error) {
        console.log("GET GAMES ERROR:", error);
        return res.json({ success: false });
      }

      const games = data.map(g => ({
        id: g.id,
        name: g.name,
        img: g.img,
        desc: g.desc,
        exePath: g.exe_path,
windowName: g.window_name
      }));

      res.json({ success: true, games });

    } catch (err) {
      console.log("GET GAMES ERROR:", err);
      res.json({ success: false });
    }
  });
  // ================= ROOT =================
app.get("/", (req, res) => {
  res.send("Server running 🚀");
});

// 👇 ADD HERE (DON'T REMOVE ANYTHING ABOVE)
app.head("/", (req, res) => {
  res.status(200).end();
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

app.head("/health", (req, res) => {
  res.status(200).end();
});
