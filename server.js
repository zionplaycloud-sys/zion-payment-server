import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Razorpay from "razorpay";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ================= ENV =================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY,
  key_secret: process.env.RAZORPAY_SECRET
});

// ================= ROOT =================
app.get("/", (req, res) => {
  res.send("Server running 🚀");
});

// ================= SIGNUP =================
app.post("/signup", async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data: existing } = await supabase
      .from("users")
      .select("*")
      .eq("username", email)
      .maybeSingle();

    if (existing) return res.json({ success: false });

    const { error } = await supabase.from("users").insert({
      username: email,
      password: password,
      hours: 0,
      pts: 0
    });

    if (error) return res.json({ success: false });

    res.json({ success: true });

  } catch {
    res.json({ success: false });
  }
});

// ================= LOGIN =================
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // ADMIN
    const { data: admin } = await supabase
      .from("admin")
      .select("*")
      .eq("username", email)
      .eq("password", password)
      .maybeSingle();

    if (admin) {
      return res.json({
        success: true,
        hrs: admin.hours || 0,
        pts: admin.pts || 0,
        isAdmin: true
      });
    }

    // USER
    const { data } = await supabase
      .from("users")
      .select("*")
      .eq("username", email)
      .eq("password", password)
      .maybeSingle();

    if (!data) return res.json({ success: false });

    res.json({
      success: true,
      hrs: data.hours || 0,
      pts: data.pts || 0,
      isAdmin: false
    });

  } catch {
    res.json({ success: false });
  }
});

// ================= UPDATE TIME =================
app.post("/update-time", async (req, res) => {
  try {
    const { email, hrs } = req.body;

    await supabase
      .from("users")
      .update({ hours: hrs })
      .eq("username", email);

    res.json({ success: true });

  } catch {
    res.json({ success: false });
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
let systemState = null;

// GET SYSTEM STATE
app.get("/get-system-state", (req, res) => {
  res.json({
    success: true,
    state: systemState
  });
});

// UPDATE SYSTEM STATE
app.post("/update-system-state", (req, res) => {
  systemState = req.body.state;
  console.log("System updated");
  res.json({ success: true });
});

// ================= EXE LAUNCH =================
app.post("/launch-exe", (req, res) => {
  const { path } = req.body;
  console.log("Launch:", path);
  res.json({ success: true });
});

// ================= CREATE PAYMENT =================
app.post("/create-order", async (req, res) => {
  try {
    const { username, plan, amount, phone } = req.body;

    console.log("📥 Incoming Order:", { username, plan, amount, phone });

    const link = await razorpay.paymentLink.create({
      amount: parseInt(amount) * 100, // ensure number
      currency: "INR",
      description: `Plan: ${plan}`,

      customer: {
        name: username || "User",
        contact: phone && phone.length >= 10 ? phone : "9876543210" // 🔥 FIXED
      },

      notify: {
        sms: true,
        email: false
      },

      reminder_enable: true,

      notes: {
        username: username,
        plan: plan
      }
    });

    console.log("✅ Payment Link Created:", link.short_url);

    res.json({
      success: true,
      link: link.short_url
    });

  } catch (err) {
    console.log("💥 FULL PAYMENT ERROR:");
    console.log(err);

    // 🔥 Send detailed error back
    res.status(500).json({
      success: false,
      error: err?.error?.description || "Payment creation failed"
    });
  }
});

// ================= WEBHOOK =================
app.post("/webhook", async (req, res) => {
  try {
    const event = req.body;

    // ✅ Only handle successful payments
    if (event.event === "payment_link.paid") {

      const payment = event.payload.payment.entity;
      const link = event.payload.payment_link.entity;

      const username = link.notes.username;
      const amount = payment.amount / 100;
      const payment_id = payment.id;

      console.log(`💰 Payment received: ${username} ₹${amount}`);

      // ================= DUPLICATE CHECK =================
      const { data: existing } = await supabase
        .from("payments")
        .select("*")
        .eq("payment_id", payment_id)
        .maybeSingle();

      if (existing) {
        console.log("⚠️ Duplicate payment ignored:", payment_id);
        return res.sendStatus(200);
      }

      // ================= PLAN LOGIC =================
      let hours = 0;
      let pts = 0;

      if (amount == 49) { hours = 1; pts = 0; }
      else if (amount == 99) { hours = 2; pts = 10; }
      else if (amount == 249) { hours = 6; pts = 25; }
      else if (amount == 399) { hours = 10; pts = 40; }
      else if (amount == 699) { hours = 20; pts = 70; }
      else if (amount == 1199) { hours = 40; pts = 120; }

      // ================= GET USER =================
      const { data: user } = await supabase
        .from("users")
        .select("*")
        .eq("username", username)
        .maybeSingle();

      if (user) {
        // ================= UPDATE USER =================
        await supabase
          .from("users")
          .update({
            hours: (user.hours || 0) + hours,
            pts: (user.pts || 0) + pts
          })
          .eq("username", username);

        console.log(`✅ Credited ${hours} hrs + ${pts} pts to ${username}`);
      } else {
        console.log("❌ User not found:", username);
      }

      // ================= SAVE PAYMENT =================
      await supabase.from("payments").insert([{
        username,
        amount,
        hours,
        pts,
        status: "paid",
        payment_id
      }]);

      console.log("📊 Payment saved to database");
    }

    res.sendStatus(200);

  } catch (err) {
    console.log("💥 Webhook error:", err);
    res.sendStatus(500);
  }
});
// ================= ADMIN STATS =================
app.get("/admin-stats", async (req, res) => {
  try {
    const range = req.query.range;

    let days = 365;
    if (range === "daily") days = 1;
    else if (range === "7d") days = 7;
    else if (range === "30d") days = 30;
    else if (range === "3m") days = 90;
    else if (range === "6m") days = 180;
    else if (range === "12m") days = 365;

    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);

    // 🔥 QUERY
  
    const { data, error } = await supabase
  .from("payments")
  .select("*")
  .ilike("status", "paid");

      // 🔥 ADD THIS LINE HERE
console.log("📊 DATA FROM DB:", data);

data.forEach(p => {
  console.log("STATUS VALUE:", p.status);
});


    if (error) {
      console.log("Stats error:", error);
      return res.json({ success: false });
    }

    let totalRevenue = 0;
    let totalOrders = data.length;
    let totalHours = 0;
    let totalPoints = 0;

    data.forEach(p => {
      totalRevenue += p.amount || 0;
      totalHours += p.hours || 0;
      totalPoints += p.pts || 0;
    });

    res.json({
      success: true,
      totalRevenue,
      totalOrders,
      totalHours,
      totalPoints
    });

  } catch (err) {
    console.log("Stats crash:", err);
    res.json({ success: false });
  }
});

// ================= START =================
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});