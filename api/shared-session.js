import { getSessionContext } from "./_lib/shared-queue-store.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      res.status(405).json({ error: "Method not allowed." });
      return;
    }

    if (!req.auth?.userId || !req.auth?.workspaceId) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

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
