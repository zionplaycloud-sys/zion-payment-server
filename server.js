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

    // ================= ADMIN LOGIN =================
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

    // ================= USER LOGIN =================
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("username", email)
      .eq("password", password)
      .maybeSingle();

    if (!user) {
      return res.json({ success: false });
    }

    // ================= SESSION CHECK =================
    const { data: session } = await supabase
      .from("sessions")
      .select("*")
      .eq("username", email)
      .maybeSingle();

    let currentTime = user.hours || 0;

    if (session) {
      // ✅ EXISTING SESSION → USE IT
      currentTime = session.time_left;
    } else {
      // 🔥 FIRST TIME LOGIN → CREATE SESSION
      await supabase
        .from("sessions")
        .insert({
          username: email,
          time_left: user.hours || 0,
          updated_at: new Date()
        });

      currentTime = user.hours || 0;
    }

    // ================= RESPONSE =================
    res.json({
      success: true,
      hrs: currentTime,
      pts: user.pts || 0,
      isAdmin: false
    });

  } catch (err) {
    console.log("LOGIN ERROR:", err);
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
    const event = req.body;

    if (event.event === "payment_link.paid") {

      const payment = event.payload.payment.entity;
      const link = event.payload.payment_link.entity;

      const username = link.notes.username;
      const amount = payment.amount / 100;

      let hours = 0;

      if (amount == 49) hours = 1;
      else if (amount == 99) hours = 2;
      else if (amount == 249) hours = 6;
      else if (amount == 399) hours = 10;
      else if (amount == 699) hours = 20;
      else if (amount == 1199) hours = 40;

      const { data: user } = await supabase
        .from("users")
        .select("*")
        .eq("username", username)
        .maybeSingle();

      if (user) {
        // 💰 UPDATE USER BALANCE
        await supabase
          .from("users")
          .update({
            hours: (user.hours || 0) + hours
          })
          .eq("username", username);

        // ⏱ UPDATE SESSION (ADD TIME)
        const { data: session } = await supabase
          .from("sessions")
          .select("*")
          .eq("username", username)
          .maybeSingle();

        let newTime = hours;

        if (session) {
          newTime = (session.time_left || 0) + hours;
        }

        await supabase
          .from("sessions")
          .upsert({
            username,
            time_left: newTime,
            updated_at: new Date()
          });

        console.log("Recharge added:", username, newTime);
      }
    }

    res.sendStatus(200);

  } catch {
    res.sendStatus(500);
  }
});

// ================= START =================
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});