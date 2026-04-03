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

    console.log("Signup:", email);

    const { data: existing, error: checkError } = await supabase
      .from("users")
      .select("*")
      .eq("username", email)
      .maybeSingle();

    if (checkError) {
      console.log("Check error:", checkError);
      return res.json({ success: false, msg: "DB error" });
    }

    if (existing) {
      return res.json({ success: false, msg: "User exists" });
    }

    const { error: insertError } = await supabase.from("users").insert({
      username: email,
      password: password,
      hours: 0,
      pts: 0
    });

    if (insertError) {
      console.log("Insert error:", insertError);
      return res.json({ success: false, msg: "Signup failed" });
    }

    res.json({ success: true });

  } catch (err) {
    console.log("Signup crash:", err);
    res.json({ success: false });
  }
});

// ================= LOGIN (UPDATED WITH ADMIN) =================
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // 🔥 1. CHECK ADMIN TABLE
    const { data: adminData, error: adminError } = await supabase
      .from("admin")
      .select("*")
      .eq("username", email)
      .eq("password", password)
      .maybeSingle();

    if (adminError) {
      console.log("Admin login error:", adminError);
    }

    if (adminData) {
      return res.json({
        success: true,
        hrs: adminData.hours || 0,
        pts: adminData.pts || 0,
        isAdmin: true
      });
    }

    // 👤 2. NORMAL USER LOGIN (UNCHANGED)
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("username", email)
      .eq("password", password)
      .maybeSingle();

    if (error) {
      console.log("Login error:", error);
      return res.json({ success: false, msg: "DB error" });
    }

    if (!data) {
      return res.json({ success: false, msg: "Invalid credentials" });
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

    const { error } = await supabase
      .from("users")
      .update({ hours: hrs })
      .eq("username", email);

    if (error) {
      console.log("Update error:", error);
      return res.json({ success: false });
    }

    res.json({ success: true });

  } catch (err) {
    console.log("Update crash:", err);
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
        contact: phone
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

      let hours = 0;
      if (amount == 49) hours = 1;
      if (amount == 99) hours = 2;
      if (amount == 249) hours = 6;
      if (amount == 399) hours = 10;
      if (amount == 699) hours = 20;
      if (amount == 1199) hours = 40;

      const { data: user } = await supabase
        .from("users")
        .select("*")
        .eq("username", username)
        .maybeSingle();

      if (user) {
        await supabase
          .from("users")
          .update({ hours: (user.hours || 0) + hours })
          .eq("username", username);

        console.log(`Credited ${hours} hrs to ${username}`);
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