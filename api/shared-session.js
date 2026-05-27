import { resolveSharedQueueAuth } from "./_lib/shared-queue-auth.js";
import { getSessionContext } from "./_lib/shared-queue-store.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      res.status(405).json({ error: "Method not allowed." });
      return;
    }

    req.auth = await resolveSharedQueueAuth(req);
    const context = await getSessionContext(req.auth);
    res.status(200).json(context);
  } catch (error) {
    if (error?.statusCode && error?.expose) {
      res.status(error.statusCode).json({
        error: error.message,
      });
      return;
    }

    res.status(500).json({
      error: "Unable to load the shared queue session.",
    });
  }
}
