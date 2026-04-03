import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Razorpay from "razorpay";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ================= DEBUG ENV =================
console.log("SUPABASE URL:", process.env.SUPABASE_URL ? "OK" : "MISSING");
console.log("SUPABASE KEY:", process.env.SUPABASE_KEY ? "OK" : "MISSING");

// ================= SUPABASE =================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ================= RAZORPAY =================
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY,
  key_secret: process.env.RAZORPAY_SECRET
});

// ================= ROOT =================
app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});


// ================= SYSTEM STATE (FIX 404) =================
let systemState = {
  pts: 0,
  hrs: 0,
  tabs: [],
  content: {
    games: [],
    shop: [],
    reward: []
  },
  homeData: {}
};

// 🔹 GET SYSTEM STATE
app.get("/get-system-state", (req, res) => {
  res.json({
    success: true,
    state: systemState
  });
});

// 🔹 UPDATE SYSTEM STATE
app.post("/update-system-state", (req, res) => {
  systemState = req.body.state;
  res.json({ success: true });
});

// ================= TEST DB =================
app.get("/test-db", async (req, res) => {
  const { data, error } = await supabase.from("users").select("*").limit(1);

  if (error) {
    console.log("DB ERROR:", error);
    return res.send("DB ERROR ❌");
  }

  res.send("DB Connected ✅");
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

    if (existing) {
      return res.json({ success: false, msg: "User exists" });
    }

    const { error } = await supabase.from("users").insert({
      username: email,
      password: password,
      hours: 0,
      pts: 0
    });

    if (error) {
      console.log("Signup error:", error);
      return res.json({ success: false });
    }

    res.json({ success: true });

  } catch (err) {
    console.log("Signup crash:", err);
    res.json({ success: false });
  }
});

// ================= LOGIN =================
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // 🔥 ADMIN LOGIN
    const { data: adminData } = await supabase
      .from("admin")
      .select("*")
      .eq("username", email)
      .eq("password", password)
      .maybeSingle();

    if (adminData) {
      return res.json({
        success: true,
        hrs: adminData.hours || 0,
        pts: adminData.pts || 0,
        isAdmin: true
      });
    }

    // 👤 USER LOGIN
    const { data } = await supabase
      .from("users")
      .select("*")
      .eq("username", email)
      .eq("password", password)
      .maybeSingle();

    if (!data) {
      return res.json({ success: false });
    }

    res.json({
      success: true,
      hrs: data.hours || 0,
      pts: data.pts || 0,
      isAdmin: false
    });

  } catch (err) {
    console.log("Login crash:", err);
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

  } catch (err) {
    console.log("Update error:", err);
    res.json({ success: false });
  }
});

// ================= CREATE PAYMENT =================
app.post("/create-order", async (req, res) => {
  try {
    const { username, plan, amount, phone } = req.body;

    const link = await razorpay.paymentLink.create({
      amount: amount * 100,
      currency: "INR",
      description: `Plan: ${plan}`,
      customer: {
        name: username,
        contact: phone || "9999999999"
      },
      notify: { sms: true },
      notes: { username, plan }
    });

    res.json({ link: link.short_url });

  } catch (err) {
    console.log("Payment error:", err);
    res.status(500).send("Payment error");
  }
});

// ================= WEBHOOK =================
app.post("/webhook", async (req, res) => {
  try {
    const event = req.body;

    if (event.event === "payment_link.paid") {

      const payment = event.payload.payment.entity;
      const link = event.payload.payment_link.entity;

      const username = link.notes.username;
      const amount = payment.amount / 100;

      // 🛑 DUPLICATE PROTECTION
      const { data: existingPayment } = await supabase
        .from("payments")
        .select("*")
        .eq("payment_id", payment.id)
        .maybeSingle();

      if (existingPayment) {
        console.log("⚠️ Duplicate payment ignored");
        return res.sendStatus(200);
      }

      let hours = 0;
      let pts = 0;

      // 🎯 PLAN LOGIC
      if (amount == 49) { hours = 1; pts = 0; }
      if (amount == 99) { hours = 2; pts = 10; }
      if (amount == 249) { hours = 6; pts = 25; }
      if (amount == 399) { hours = 10; pts = 40; }
      if (amount == 699) { hours = 20; pts = 70; }
      if (amount == 1199) { hours = 40; pts = 120; }

      // 🧑 GET USER
      const { data: user } = await supabase
        .from("users")
        .select("*")
        .eq("username", username)
        .maybeSingle();

      if (user) {

        // ➕ UPDATE USER
        await supabase
          .from("users")
          .update({
            hours: (user.hours || 0) + hours,
            pts: (user.pts || 0) + pts
          })
          .eq("username", username);

        // 💾 SAVE PAYMENT
        await supabase.from("payments").insert({
          username,
          amount,
          hours,
          pts,
          status: "paid",
          payment_id: payment.id,
          plan: link.notes.plan
        });

        console.log(`✅ ${username} paid ₹${amount}`);
      }
    }

    res.sendStatus(200);

  } catch (err) {
    console.log("Webhook error:", err);
    res.sendStatus(500);
  }
});

// ================= START =================
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});