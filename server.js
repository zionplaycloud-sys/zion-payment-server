import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Razorpay from "razorpay";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// 🔐 Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 🔐 Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY,
  key_secret: process.env.RAZORPAY_SECRET
});

// 🟢 ROOT
app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});

// ================= SIGNUP =================
app.post("/signup", async (req, res) => {
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
});

// ================= LOGIN =================
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

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
    pts: data.pts || 0
  });
});

// ================= UPDATE TIME =================
app.post("/update-time", async (req, res) => {
  const { email, hrs } = req.body;

  await supabase
    .from("users")
    .update({ hours: hrs })
    .eq("username", email);

  res.json({ success: true });
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
        .update({ hours: user.hours + hours })
        .eq("username", username);
    }
  }

  res.sendStatus(200);
});

// ================= START =================
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});