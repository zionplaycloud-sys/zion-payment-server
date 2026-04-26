  import express from "express";
  import cors from "cors";
  import dotenv from "dotenv";
  import { createClient } from "@supabase/supabase-js";
  import { exec } from "child_process";
  import { v4 as uuidv4 } from "uuid";
  import fetch from "node-fetch";
  import bcrypt from "bcrypt";
import { Resend } from "resend";

  dotenv.config();
  const resend = new Resend(process.env.RESEND_API_KEY);
 const activeSessions = {};
 const launchLocks = {};
 let maintenanceMode = false;
 const loginAttempts = {};
 const paymentLocks = {};
 function cleanupOldSessions() {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 mins

  for (const sessionId in activeSessions) {
    const session = activeSessions[sessionId];

    if (!session.createdAt) continue;

    if (now - session.createdAt > maxAge) {
      console.log("ðŸ§¹ Removing stale session:", sessionId);

      delete activeSessions[sessionId];
    }
  }
}
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

  function generateVoucherCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "ZP-";

  for (let i = 0; i < 8; i++) {
    result += chars.charAt(
      Math.floor(Math.random() * chars.length)
    );
  }

  return result;
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
    // Normal top-up plans
    { id: "starter_1h", amount: 100, hours: 1, cashBackPts: 10, kind: "standard" },
    { id: "gamer_3h", amount: 199, hours: 3, cashBackPts: 19, kind: "standard" },
    { id: "popular_8h", amount: 499, hours: 8, cashBackPts: 49, featured: true, kind: "standard" },
    { id: "pro_20h", amount: 999, hours: 20, cashBackPts: 99, kind: "standard" },
    { id: "ultra_60h", amount: 2499, hours: 60, cashBackPts: 249, kind: "standard" },

    // Validity passes
    { id: "weekend_pass", amount: 799, hours: 16, cashBackPts: 79, validDays: 2, kind: "pass" },
    { id: "pass_15d", amount: 1799, hours: 40, cashBackPts: 179, validDays: 15, kind: "pass" },
    { id: "vip_pass", amount: 3999, hours: 100, cashBackPts: 399, validDays: 30, kind: "pass" },
    { id: "pro_pass_90d", amount: 9999, hours: 350, cashBackPts: 999, validDays: 90, kind: "pass" },
    { id: "elite_pass_180d", amount: 18999, hours: 800, cashBackPts: 1899, validDays: 180, kind: "pass" },
    { id: "ultimate_pass_340d", amount: 34999, hours: 1800, cashBackPts: 3499, validDays: 340, kind: "pass" },

    // Gift cards (creates voucher code for recipient/use later)
    { id: "gift_1h", amount: 100, hours: 1, cashBackPts: 0, kind: "gift_card" },
    { id: "gift_3h", amount: 199, hours: 3, cashBackPts: 0, kind: "gift_card" },
    { id: "gift_8h", amount: 499, hours: 8, cashBackPts: 0, kind: "gift_card" },
    { id: "gift_20h", amount: 999, hours: 20, cashBackPts: 0, kind: "gift_card" },
    { id: "gift_60h", amount: 2499, hours: 60, cashBackPts: 0, kind: "gift_card" }
  ];

  const POINTS_MARKUP_MULTIPLIER = 1.3; // +30% points cost

  function parseOrderAmount(rawAmount) {
    const amount = Number(String(rawAmount ?? "").replace(/[^\d.]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) return Number.NaN;
    return Math.round(amount);
  }

  function resolvePlan(rawAmount, planId = "") {
    const normalizedPlanId = (planId || "").toString().trim().toLowerCase();
    if (normalizedPlanId) {
      return SHOP_PLANS.find((p) => p.id === normalizedPlanId) || null;
    }

    const rounded = parseOrderAmount(rawAmount);
    if (!Number.isFinite(rounded) || rounded <= 0) return null;
    const matches = SHOP_PLANS.filter((p) => p.amount === rounded);
    if (matches.length === 1) return matches[0];
    return null;
  }

  function getPlanExpiryDate(plan) {
    const days = Number(plan?.validDays || 0);
    if (!Number.isFinite(days) || days <= 0) return null;
    const expiresAt = new Date();
    expiresAt.setUTCDate(expiresAt.getUTCDate() + days);
    return expiresAt;
  }

  let hourGrantsTableChecked = false;
  let hourGrantsTableReady = false;

  async function isHourGrantsTableReady() {
    if (hourGrantsTableChecked) {
      return hourGrantsTableReady;
    }

    const { error } = await supabase
      .from("user_hour_grants")
      .select("id")
      .limit(1);

    hourGrantsTableChecked = true;
    hourGrantsTableReady = !error;

    if (error) {
      console.log("âš  user_hour_grants table not available. Expiry tracking disabled.");
    }

    return hourGrantsTableReady;
  }

  async function addHourGrantRecord(username, totalHours, expiresAt, sourceType, sourceId) {
    const hours = Number(totalHours || 0);
    if (!hours || hours <= 0) return;

    if (!(await isHourGrantsTableReady())) {
      return;
    }

    const payload = {
      username,
      source_type: sourceType || "topup",
      source_id: sourceId || "",
      total_hours: hours,
      remaining_hours: hours,
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null
    };

    const { error } = await supabase.from("user_hour_grants").insert(payload);
    if (error) {
      console.log("HOUR GRANT INSERT ERROR:", error.message || error);
    }
  }

  async function consumeHourGrants(username, consumedHours) {
    const amount = Number(consumedHours || 0);
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (!(await isHourGrantsTableReady())) return;

    let remainingToConsume = amount;
    const { data: grants, error } = await supabase
      .from("user_hour_grants")
      .select("id, remaining_hours")
      .eq("username", username)
      .gt("remaining_hours", 0)
      .order("expires_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (error || !Array.isArray(grants)) return;

    for (const grant of grants) {
      if (remainingToConsume <= 0) break;
      const current = Number(grant.remaining_hours || 0);
      if (current <= 0) continue;
      const next = Math.max(0, current - remainingToConsume);
      const usedHere = current - next;
      remainingToConsume -= usedHere;

      await supabase
        .from("user_hour_grants")
        .update({ remaining_hours: next })
        .eq("id", grant.id);
    }
  }

  async function expireUserHours(username) {
    if (!(await isHourGrantsTableReady())) {
      return { expiredHours: 0 };
    }

    const nowIso = new Date().toISOString();
    const { data: expiredGrants, error } = await supabase
      .from("user_hour_grants")
      .select("id, remaining_hours")
      .eq("username", username)
      .gt("remaining_hours", 0)
      .lte("expires_at", nowIso);

    if (error || !Array.isArray(expiredGrants) || expiredGrants.length === 0) {
      return { expiredHours: 0 };
    }

    const expiredHours = expiredGrants.reduce(
      (sum, row) => sum + Number(row.remaining_hours || 0),
      0
    );

    const ids = expiredGrants.map((x) => x.id);
    await supabase
      .from("user_hour_grants")
      .update({ remaining_hours: 0 })
      .in("id", ids);

    if (expiredHours > 0) {
      const { data: session } = await supabase
        .from("sessions")
        .select("time_left")
        .eq("username", username)
        .maybeSingle();

      const { data: user } = await supabase
        .from("users")
        .select("hours")
        .eq("username", username)
        .maybeSingle();

      const nextTimeLeft = Math.max(0, Number(session?.time_left || 0) - expiredHours);
      const nextHours = Math.max(0, Number(user?.hours || 0) - expiredHours);

      await supabase
        .from("sessions")
        .upsert({
          username,
          time_left: nextTimeLeft,
          updated_at: new Date()
        });

      await supabase
        .from("users")
        .update({ hours: nextHours })
        .eq("username", username);
    }

    return { expiredHours };
  }

  function pointsCostForPlan(plan) {
    return Math.ceil(plan.amount * POINTS_MARKUP_MULTIPLIER);
  }

  async function applyUserCredit(username, addHours = 0, addPts = 0, options = {}) {
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

    if (Number(addHours || 0) > 0) {
      await addHourGrantRecord(
        username,
        Number(addHours || 0),
        options.expiresAt || null,
        options.sourceType || "topup",
        options.sourceId || ""
      );
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
    res.send("Server running ðŸš€");
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

    // ðŸ”¥ HASH PASSWORD
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
const userKey = email.toLowerCase();

if (!loginAttempts[userKey]) {
  loginAttempts[userKey] = {
    count: 0,
    lastAttempt: Date.now()
  };
}

if (
  loginAttempts[userKey].count >= 5 &&
  Date.now() - loginAttempts[userKey].lastAttempt < 15 * 60 * 1000
) {
  return res.json({
    success: false,
    error: "Too many failed login attempts. Try again in 15 minutes."
  });
}
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
  loginAttempts[userKey].count += 1;
  loginAttempts[userKey].lastAttempt = Date.now();

  return res.json({
    success: false,
    error: "Invalid credentials"
  });
}

const isMatch = await bcrypt.compare(password, user.password);

if (!isMatch) {
  loginAttempts[userKey].count += 1;
  loginAttempts[userKey].lastAttempt = Date.now();

  return res.json({
    success: false,
    error: "Invalid credentials"
  });
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

// ðŸ”¥ SESSION CHECK (MOVE HERE)
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

const expiryResult = await expireUserHours(email);
if (expiryResult.expiredHours > 0) {
  const { data: refreshedSession } = await supabase
    .from("sessions")
    .select("time_left")
    .eq("username", email)
    .maybeSingle();
  currentTime = Number(refreshedSession?.time_left || 0);
}
loginAttempts[userKey] = {
  count: 0,
  lastAttempt: Date.now()
};

return res.json({
  success: true,
  username: user.username,
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
      const { username, amount, planId } = req.body || {};
      if (!username) {
        return res.json({ success: false, error: "Username required" });
      }

      const plan = resolvePlan(amount, planId);
      if (!plan) {
        return res.json({ success: false, error: "Invalid plan selection" });
      }

      if (plan.kind === "gift_card") {
        return res.json({
          success: false,
          error: "Gift cards can be purchased only with cash"
        });
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

      const credit = await applyUserCredit(username, plan.hours, -requiredPoints, {
        expiresAt: getPlanExpiryDate(plan),
        sourceType: "points_purchase",
        sourceId: plan.id
      });

      if (!credit.success) {
        return res.json({ success: false, error: credit.error || "Purchase failed" });
      }

      return res.json({
        success: true,
        mode: "points",
        planId: plan.id,
        planAmount: plan.amount,
        hoursAdded: plan.hours,
        validDays: plan.validDays || 0,
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
      const { email, hrs, pts } = req.body || {};
      if (!email) return res.json({ success: false });

      const credit = await applyUserCredit(
        email,
        Number(hrs || 0),
        Number(pts || 0),
        {
          sourceType: "admin_add",
          sourceId: "admin"
        }
      );

      if (!credit.success) {
        return res.json({ success: false, error: credit.error || "Failed to add" });
      }

      res.json({ success: true });
    } catch (err) {
      console.log("ADMIN ADD ERROR:", err);
      res.json({ success: false });
    }
  });

  // ================= TOGGLE MAINTENANCE =================
  app.post("/toggle-maintenance", async (req, res) => {
    try {
      const { enabled } = req.body;
      maintenanceMode = !!enabled;

      console.log("Maintenance Mode:", maintenanceMode);
      res.json({
        success: true,
        maintenanceMode
      });
    } catch (err) {
      console.log("TOGGLE MAINTENANCE ERROR:", err);
      res.json({ success: false });
    }
  });

  // ================= GENERATE VOUCHERS =================
  app.post("/generate-vouchers", async (req, res) => {
    try {
      const voucherList = [];

      for (let i = 0; i < 10; i++) {
        voucherList.push({
          code: generateVoucherCode(),
          hours: 1,
          created_by: "admin",
          used: false
        });
      }

      const { error } = await supabase
        .from("vouchers")
        .insert(voucherList);

      if (error) {
        console.log("VOUCHER GENERATION ERROR:", error);
        return res.json({ success: false, error: error.message });
      }

      res.json({ success: true, count: 10 });
    } catch (err) {
      console.log("GENERATE VOUCHERS ERROR:", err);
      res.json({ success: false });
    }
  });

  // ================= REDEEM VOUCHER =================
  app.post("/redeem-voucher", async (req, res) => {
    try {
      const { username, code } = req.body || {};
      if (!username || !code) {
        return res.json({ success: false, error: "Missing fields" });
      }

      const cleanCode = code.trim().toUpperCase();

      const { data: voucher, error: fetchError } = await supabase
        .from("vouchers")
        .select("*")
        .eq("code", cleanCode)
        .single();

      if (fetchError || !voucher) {
        return res.json({ success: false, error: "Invalid voucher code" });
      }

      if (voucher.used) {
        return res.json({ success: false, error: "Voucher already used" });
      }

      const credit = await applyUserCredit(
        username,
        Number(voucher.hours || 0),
        0,
        {
          sourceType: "voucher",
          sourceId: cleanCode
        }
      );

      if (!credit.success) {
        return res.json({ success: false, error: credit.error || "Failed to apply voucher" });
      }

      await supabase
        .from("vouchers")
        .update({
          used: true,
          used_by: username
        })
        .eq("code", cleanCode);

      res.json({
        success: true,
        addedHours: Number(voucher.hours || 0),
        totalHours: credit.timeLeft
      });
    } catch (err) {
      console.log("REDEEM VOUCHER ERROR:", err);
      res.json({ success: false, error: "Server error" });
    }
  });

  // ================= SYSTEM STATE =================
  app.get("/get-system-state", async (req, res) => {
    try {
      const { data } = await supabase.from("sessions").select("*");
      let state = {};

      for (const row of data || []) {
        await expireUserHours(row.username);
      }

      const { data: refreshed } = await supabase.from("sessions").select("*");
      (refreshed || []).forEach((row) => {
        state[row.username] = {
          timeLeft: row.time_left
        };
      });

      res.json({ success: true, state });
    } catch (err) {
      console.log("GET SYSTEM STATE ERROR:", err);
      res.json({ success: false });
    }
  });

  app.post("/update-system-state", async (req, res) => {
    try {
      const state = req.body.state;
      const email = Object.keys(state || {})[0];
      const timeLeft = state?.[email]?.timeLeft;

      if (!email) {
        return res.json({ success: false });
      }

      await expireUserHours(email);

      const { data: existingSession } = await supabase
        .from("sessions")
        .select("time_left")
        .eq("username", email)
        .maybeSingle();

      const previousTimeLeft = Number(existingSession?.time_left || 0);
      const nextTimeLeft = Number(timeLeft || 0);

      if (
        Number.isFinite(previousTimeLeft) &&
        Number.isFinite(nextTimeLeft) &&
        previousTimeLeft > nextTimeLeft
      ) {
        await consumeHourGrants(email, previousTimeLeft - nextTimeLeft);
      }

      await supabase
        .from("sessions")
        .upsert({
          username: email,
          time_left: timeLeft,
          updated_at: new Date()
        });

      res.json({ success: true });
    } catch (err) {
      console.log("UPDATE SYSTEM STATE ERROR:", err);
      res.json({ success: false });
    }
  });

  // ================= WEBHOOK =================
  app.post("/webhook", async (req, res) => {
    try {
      const data = req.body;

      console.log("Cashfree webhook received:");
      console.log(JSON.stringify(data, null, 2));

      const payment = data.data?.payment;
      const order = data.data?.order;

      if (payment?.payment_status !== "SUCCESS") {
        console.log("Not a success payment");
        return res.sendStatus(200);
      }

      const orderId = order?.order_id;
      const amount = Number(order?.order_amount);
      const planId = order?.order_tags?.planId || "";
      const username = order?.order_tags?.username;

      if (!orderId || !username || !amount) {
        console.log("Missing data");
        return res.sendStatus(400);
      }

      const { data: existing } = await supabase
        .from("payments")
        .select("*")
        .eq("order_id", orderId)
        .maybeSingle();

      if (existing) {
        console.log("Duplicate webhook ignored");
        return res.sendStatus(200);
      }

      await supabase.from("payments").insert({
        order_id: orderId,
        username,
        amount
      });

      const plan = resolvePlan(amount, planId);
      if (!plan) {
        console.log("Invalid plan");
        return res.sendStatus(400);
      }

      if (plan.kind === "gift_card") {
  const code = generateVoucherCode();

  const { error: voucherError } = await supabase
    .from("vouchers")
    .insert({
      code,
      hours: plan.hours,
      created_by: username,
      used: false
    });

  if (voucherError) {
    console.log("GIFT VOUCHER CREATE ERROR:", voucherError);
    return res.sendStatus(500);
  }

  console.log("Gift voucher created:", {
    username,
    planId: plan.id,
    code
  });

  // 🔥 AUTO EMAIL SEND USING RESEND
  try {
    await resend.emails.send({
      from: "Zion Play <onboarding@resend.dev>", // change this to your verified Resend domain
      to: [username],
      subject: "Your Zion Play Gift Card Code",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2 style="color: #00d4ff;">Gift Card Generated</h2>

          <p>Your Zion Play purchase was successful.</p>

          <p><strong>Plan:</strong> ${plan.id}</p>
          <p><strong>Hours:</strong> ${plan.hours} Hours</p>
          <p><strong>Voucher Code:</strong> ${code}</p>
          <p><strong>Purchase Date:</strong> ${new Date().toLocaleDateString("en-IN")}</p>
          <p><strong>Validity:</strong> No Expiry</p>

          <br>

          <p>Please keep this voucher code safe.</p>

          <p>You can redeem this code inside Zion Play using the Redeem Voucher option.</p>

          <br>

          <p>Thank you for choosing Zion Play.</p>

          <p><strong>— Zion Play Cloud Gaming</strong></p>
        </div>
      `
    });

    console.log("Email sent successfully to:", username);

  } catch (emailError) {
    console.log("EMAIL SEND ERROR:", emailError);
  }

  return res.sendStatus(200);
}

      const { data: userBefore } = await supabase
        .from("users")
        .select("hours")
        .eq("username", username)
        .maybeSingle();

      const isFirstPurchase = !userBefore || Number(userBefore.hours || 0) === 0;
      const totalHours = plan.hours + (isFirstPurchase ? 0.5 : 0);

      const buyerCredit = await applyUserCredit(
        username,
        totalHours,
        plan.cashBackPts,
        {
          expiresAt: getPlanExpiryDate(plan),
          sourceType: "cash_purchase",
          sourceId: plan.id
        }
      );

      if (!buyerCredit.success) {
        console.log("Buyer credit failed:", buyerCredit.error);
        return res.sendStatus(500);
      }

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
          console.log("Referral points applied:", referrer, referralPts);
        } else {
          console.log("Referral failed:", referralCredit.error);
        }
      }

      console.log("Purchase success:", username, {
        planId: plan.id,
        hours: plan.hours,
        cashbackPts: plan.cashBackPts
      });

      res.sendStatus(200);
    } catch (err) {
      console.log("Webhook error:", err);
      res.sendStatus(500);
    }
  });
// ================= CREATE ORDER =================
app.post("/create-order", async (req, res) => {
  try {

    if (maintenanceMode) {
      return res.json({
        success: false,
        error: "Server under maintenance. Payments are temporarily disabled."
      });
    }

    const { amount, username, paymentEmail, paymentPhone, planId } = req.body;

    if (paymentLocks[username]) {
      return res.json({
        success: false,
        error: "Payment already in progress. Please wait."
      });
    }

    paymentLocks[username] = true;

    const plan = resolvePlan(amount, planId);
    const orderAmount = plan?.amount || Number.NaN;
    const loginEmail = sanitizeEmail(username);

    if (!username || !plan || !Number.isFinite(orderAmount) || orderAmount <= 0) {
      return res.json({
        success: false,
        error: "Invalid order payload",
        details: {
          usernamePresent: Boolean(username),
          planId: planId || "",
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

// ðŸ”¥ AUTO SWITCH (SANDBOX / PRODUCTION)
const CASHFREE_BASE_URL =
  process.env.CASHFREE_MODE === "sandbox"
    ? "https://sandbox.cashfree.com/pg"
    : "https://api.cashfree.com/pg";

console.log("ðŸŒ Using Cashfree URL:", CASHFREE_BASE_URL);

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
      username,
      planId: plan.id
    },
    customer_details: {
      customer_id: customerId,
      customer_email: customerEmail,
      customer_phone: customerPhone
    }
  })
});

const data = await response.json();

// ðŸ”´ ERROR HANDLING
if (!response.ok) {
  console.log("âŒ Cashfree error response:", data);
  return res.json({
    success: false,
    error: data?.message || data?.error?.message || "Cashfree order failed"
  });
}

// âœ… SUCCESS LOG
console.log("âœ… Cashfree FULL response:", data);

delete paymentLocks[username];

res.json({
  success: true,
  payment_session_id: data.payment_session_id
});

 } catch (err) {
  console.log("CREATE ORDER ERROR:", err);

  const username = req.body?.username;

  if (username) {
    delete paymentLocks[username];
  }

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
          // Rough estimate: â‚¹100 per hour
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
      console.log("âŒ Missing path or sessionId");
      return res.json({ success: false });
    }

    console.log("ðŸš€ Launch-agent request:", { path, sessionId });

    // ðŸ”¥ GET GAME FROM DB (to get window_name)
    const { data: game, error } = await supabase
      .from("games")
      .select("*")
      .eq("exe_path", path)
      .maybeSingle();

    if (error) {
      console.log("âŒ DB error:", error);
      return res.json({ success: false });
    }

    if (!game) {
      console.log("âš ï¸ Game not found for path:", path);
    }

    const windowName =
      game?.window_name ||
      requestedWindowName ||
      requestedGameName ||
      "";

    console.log("ðŸŽ¯ Window target:", windowName);

    // âš ï¸ Safety log (important for debugging)
    if (!windowName) {
      console.log("âš ï¸ window_name missing â†’ may capture full screen");
    }

 // ðŸ”¥ SEND TO AGENT
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

// ðŸ”¥ SAFE PARSE (IMPORTANT)
const text = await launchRes.text();

let data;

try {
  data = JSON.parse(text);
} catch (err) {
  console.log("âŒ Agent returned NON-JSON:");
  console.log(text.slice(0, 200)); // log first part

  return res.json({
    success: false,
    error: "Agent unreachable (tunnel delay)"
  });
}

console.log("âœ… Agent response:", data);

return res.json(data);

  } catch (err) {
    console.log("âŒ LAUNCH AGENT ERROR:", err);
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

      // ðŸ”¥ WINDOWS: Kill process by name
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

    // ðŸ”¥ MAINTENANCE CHECK MUST BE FIRST
    if (maintenanceMode) {
      return res.json({
        success: false,
        error: "Server under maintenance. Please try again later."
      });
    }

    const existingSession = Object.entries(activeSessions).find(
      ([id, session]) => session.username === username
    );

    if (existingSession) {
      const [existingSessionId, sessionData] = existingSession;

      console.log("â™»ï¸ Reconnecting existing session:", existingSessionId);

      return res.json({
        success: true,
        reconnect: true,
        sessionId: existingSessionId,
        pc: sessionData.pc,
        streamBaseUrl
      });
    }

    if (!username || !game) {
      return res.json({
        success: false,
        error: "Missing required fields"
      });
    }

    cleanupOldSessions();

    if (
  launchLocks[username] &&
  Date.now() - launchLocks[username].createdAt < 2 * 60 * 1000
) {
      return res.json({
        success: false,
        error: "Launch already in progress"
      });
    }

    launchLocks[username] = {
  createdAt: Date.now()
};

    // âŒ REMOVE THIS (NOT USED ANYMORE)
    // const agentBase = process.env.AGENT_URL;

    // ðŸ” Check if user already has PC
    const { data: existing } = await supabase
      .from("pcs")
      .select("*")
      .eq("current_user", username)
      .maybeSingle();

    // ðŸ”¥ ALWAYS CREATE NEW SESSION
    const sessionId = uuidv4();

    // ðŸ”¥ GET GAME DATA (IMPORTANT)
    const { data: gameData, error: gameError } = await supabase
      .from("games")
      .select("*")
      .eq("name", game)
      .single();

    if (gameError || !gameData) {
      console.log("âŒ Game not found");
        delete launchLocks[username];

      return res.json({ success: false, error: "Game not found" });
    }

    const exePath = gameData.exe_path;
    const windowName = gameData.window_name;

    console.log("ðŸŽ¯ Game selected:", gameData.name);
    console.log("ðŸŽ¯ Window target:", windowName);

    // ðŸ”¥ EXISTING PC CASE
if (existing) {
activeSessions[sessionId] = {
  username,
  pc: existing.name,
  createdAt: Date.now()
};
  console.log("ðŸŽ® Session created (existing):", sessionId);

  try {
    const existingAgentResponse = await fetch(`${existing.agent_url}/launch-agent`, {
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

    if (!existingAgentResponse.ok) {
      throw new Error("Existing PC launch failed");
    }
delete launchLocks[username];
    return res.json({
      success: true,
      pc: existing.name,
      sessionId,
      streamBaseUrl
    });

  } catch (err) {
    console.log("âŒ Existing PC failed, releasing stale lock:", err);

    // ðŸ”“ Release broken existing lock
    await supabase
      .from("pcs")
      .update({
        status: "free",
        current_user: null
      })
      .eq("id", existing.id);

    delete activeSessions[sessionId];

    // Continue flow â†’ assign fresh PC
  }
}

    // ðŸ” Find free PC
    const { data: pcs } = await supabase
      .from("pcs")
      .select("*")
      .eq("status", "free")
.order("id", { ascending: true })
.limit(1);

    if (!pcs || pcs.length === 0) {
        delete launchLocks[username];

      return res.json({ success: false, error: "No PC available" });
    }

    const pc = pcs[0];

    // ðŸ”’ Mark busy
    await supabase
      .from("pcs")
      .update({
        status: "busy",
        current_user: username
      })
      .eq("id", pc.id);

    console.log(`Assigned ${pc.name} to ${username}`);

    // ðŸ”¥ STORE SESSION
activeSessions[sessionId] = {
  username,
  pc: pc.name,
  createdAt: Date.now()
};
    console.log("ðŸŽ® Session created:", sessionId);

    // ðŸ”¥ SEND TO CORRECT AGENT (THIS IS THE FIX)
      try {
      const agentResponse = await fetch(`${pc.agent_url}/launch-agent`, {
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

      if (!agentResponse.ok) {
        throw new Error("Agent launch failed");
      }

      console.log("âœ… Session sent to agent:", pc.agent_url);

    } catch (err) {
      console.log("âŒ Agent launch failed, releasing PC:", err);

      // ðŸ”“ AUTO RELEASE FAILED PC
      await supabase
        .from("pcs")
        .update({
          status: "free",
          current_user: null
        })
        .eq("id", pc.id);

      delete activeSessions[sessionId];
delete launchLocks[username];
      return res.json({
        success: false,
        error: "Agent unavailable. Please try again."
      });
    }

    // âœ… FINAL RESPONSE (ONLY ONCE)
    delete launchLocks[username];

    res.json({
      success: true,
      pc: pc.name,
      sessionId,
      streamBaseUrl
    });

  } catch (err) {
    console.log("ASSIGN PC ERROR:", err);
      delete launchLocks[username];

    res.json({ success: false });
  }
});

// ================= CHECK SESSION =================
app.post("/check-session", async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.json({
        success: false,
        valid: false
      });
    }

    if (activeSessions[sessionId]) {
      return res.json({
        success: true,
        valid: true,
        session: activeSessions[sessionId]
      });
    }

    return res.json({
      success: true,
      valid: false
    });

  } catch (err) {
    console.log("CHECK SESSION ERROR:", err);

    res.json({
      success: false,
      valid: false
    });
  }
});

// ================= RELEASE PC =================
app.post("/release-pc", async (req, res) => {
  try {
    const { username } = req.body;

    // ðŸ”“ Free PC in database
    await supabase
      .from("pcs")
      .update({
        status: "free",
        current_user: null
      })
      .eq("current_user", username);

    // ðŸ§¹ Remove old active session from memory
    for (const sessionId in activeSessions) {
      if (activeSessions[sessionId].username === username) {
        console.log("ðŸ§¹ Removing old session:", sessionId);
        delete activeSessions[sessionId];
      }
    }

    // ðŸ—‘ Remove old session row from sessions table
await supabase
  .from("sessions")
  .update({
    updated_at: new Date()
  })
  .eq("username", username);

    // ðŸ”“ Remove launch lock too
    delete launchLocks[username];

    res.json({
      success: true
    });

  } catch (err) {
    console.log("RELEASE PC ERROR:", err);

    res.json({
      success: false
    });
  }
}); 
  // ================= GAMES SYSTEM =================

  // SAVE GAMES
  app.post("/save-games", async (req, res) => {
    try {
      const { games } = req.body;

      // ðŸ”¥ Delete old games
      await supabase.from("games").delete().neq("id", "");

      // ðŸ”¥ Insert new games
      const { error } = await supabase.from("games").insert(
       games.map(g => ({
  name: g.name,
  img: g.img,
  desc: g.desc,
  exe_path: g.exePath,
  window_name: g.windowName || g.name   // ðŸ”¥ IMPORTANT
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
  res.send("Server running ðŸš€");
});

// ðŸ‘‡ ADD HERE (DON'T REMOVE ANYTHING ABOVE)
app.head("/", (req, res) => {
  res.status(200).end();
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

app.head("/health", (req, res) => {
  res.status(200).end();
});


