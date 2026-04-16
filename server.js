  import express from "express";
  import cors from "cors";
  import dotenv from "dotenv";
  import { createClient } from "@supabase/supabase-js";
  import { exec } from "child_process";
  import { v4 as uuidv4 } from "uuid";
  import fetch from "node-fetch";

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
    const data = req.body;

    console.log("🔥 Cashfree webhook:", JSON.stringify(data, null, 2));

    if (
      data.type === "PAYMENT_SUCCESS_WEBHOOK" ||
      data.data?.payment?.payment_status === "SUCCESS"
    ) {
      const email =
        data.data?.customer_details?.customer_email ||
        data.data?.order?.customer_details?.customer_email;

      const amount = data.data?.order?.order_amount;

      let hours = 0;

      if (amount == 49) hours = 1;
      else if (amount == 99) hours = 2;
      else if (amount == 249) hours = 6;
      else if (amount == 399) hours = 10;
      else if (amount == 699) hours = 20;

      const { data: user } = await supabase
        .from("users")
        .select("*")
        .eq("username", email)
        .maybeSingle();

      if (user) {
        await supabase
          .from("users")
          .update({
            hours: (user.hours || 0) + hours
          })
          .eq("username", email);

        const { data: session } = await supabase
          .from("sessions")
          .select("*")
          .eq("username", email)
          .maybeSingle();

        let newTime = hours;

        if (session) {
          newTime = (session.time_left || 0) + hours;
        }

        await supabase
          .from("sessions")
          .upsert({
            username: email,
            time_left: newTime,
            updated_at: new Date()
          });

        console.log("🔥 Hours added:", email, hours);
      } else {
        console.log("⚠️ User not found:", email);
      }
    }

    res.sendStatus(200);

  } catch (err) {
    console.log("❌ Webhook error:", err);
    res.sendStatus(500);
  }
});

 app.post("/create-order", async (req, res) => {
  try {
    const { amount, username } = req.body;
    const email = username;

    console.log("Creating order for:", email, amount);

    const orderId = "order_" + Date.now();

    const response = await fetch("https://sandbox.cashfree.com/pg/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-version": "2022-09-01",
        "x-client-id": process.env.CASHFREE_APP_ID,
        "x-client-secret": process.env.CASHFREE_SECRET_KEY
      },
      body: JSON.stringify({
        order_id: orderId,
        order_amount: amount,
        order_currency: "INR",
        customer_details: {
          customer_id: email,
          customer_email: email,
          customer_phone: "9999999999"
        }
      })
    });

    const data = await response.json();

    // ✅ NOW LOG HERE (CORRECT PLACE)
    console.log("Cashfree FULL response:", data);

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

    const { path, sessionId } = req.body;

    if (!path || typeof path !== "string") {
      return res.json({ success: false, error: "Invalid path" });
    }

    if (!sessionId) {
      return res.json({ success: false, error: "Missing sessionId" });
    }

    console.log("🚀 Launching with session:", sessionId);

    const agentToken = process.env.AGENT_LAUNCH_TOKEN || "";

    const headers = {
      "Content-Type": "application/json"
    };

    if (agentToken) {
      headers["x-agent-token"] = agentToken;
    }

    // ✅ Check agent alive
    const statusRes = await fetch(`${agentBase}/status`);
    if (!statusRes.ok) {
      return res.json({ success: false, error: "Agent offline" });
    }

    // ✅ SEND sessionId to agent
    const launchRes = await fetch(`${agentBase}/launch-agent`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        path,
        sessionId   // 🔥 THIS IS THE FIX
      })
    });

    const data = await launchRes.json();

    return res.json(data);

  } catch (err) {
    console.log("❌ LAUNCH AGENT ERROR:", err);
    return res.json({ success: false, error: "Agent connection failed" });
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

    // 🔁 Check if user already has PC
    const { data: existing } = await supabase
      .from("pcs")
      .select("*")
      .eq("current_user", username)
      .maybeSingle();

    // 🔥 ALWAYS CREATE NEW SESSION
    const sessionId = uuidv4();

    if (existing) {
      activeSessions[sessionId] = {
        username,
        pc: existing.name
      };

      console.log("🎮 Session created (existing):", sessionId);

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
      return res.json({ success: false });
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

// 🔥 SEND SESSION TO AGENT (FIX)
try {
  const agentBase = process.env.AGENT_URL;

  if (agentBase) {
    await fetch(`${agentBase}/launch-agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        path: "",          // keep empty if already launched separately
        sessionId: sessionId
      })
    });

    console.log("✅ Session sent to agent:", sessionId);
  }
} catch (err) {
  console.log("❌ Agent session send failed:", err);
}

// ✅ RESPONSE (UNCHANGED)
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
          exe_path: g.exePath
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
        exePath: g.exe_path
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




