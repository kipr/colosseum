import express, { Request, Response } from 'express';
import { AuthRequest, requireAuth } from '../middleware/auth';
import { getDatabase } from '../database/connection';

const router = express.Router();

interface ChatMessage {
  id: number;
  spreadsheet_id: string;
  sender_name: string;
  message: string;
  is_admin: boolean;
  user_id: number | null;
  created_at: string;
}

// Helper to fix SQLite UTC timestamps (add 'Z' suffix for proper parsing)
function fixTimestamp(msg: ChatMessage): ChatMessage {
  // SQLite CURRENT_TIMESTAMP is UTC but without 'Z', so JS parses it as local time
  // Add 'Z' to make it parse correctly as UTC
  if (msg.created_at && !msg.created_at.endsWith('Z')) {
    return { ...msg, created_at: msg.created_at.replace(' ', 'T') + 'Z' };
  }
  return msg;
}

// Get all active spreadsheets (unique by spreadsheet_id) for chat room list
router.get('/spreadsheets', async (req: Request, res: Response) => {
  try {
    const db = await getDatabase();
    // Get unique active spreadsheets (excluding placeholders)
    const spreadsheets = await db.all(`
      SELECT DISTINCT spreadsheet_id, spreadsheet_name 
      FROM spreadsheet_configs 
      WHERE is_active = 1 AND sheet_name != '__SPREADSHEET_PLACEHOLDER__'
      ORDER BY spreadsheet_name
    `);
    res.json(spreadsheets);
  } catch (error) {
    console.error('Error fetching spreadsheets for chat:', error);
    res.status(500).json({ error: 'Failed to fetch spreadsheets' });
  }
});

// Get messages for a specific spreadsheet chat room
router.get('/messages/:spreadsheetId', async (req: Request, res: Response) => {
  try {
    const { spreadsheetId } = req.params;
    const { limit = 100, before } = req.query;
    
    const db = await getDatabase();
    
    let query = `
      SELECT id, spreadsheet_id, sender_name, message, is_admin, created_at 
      FROM chat_messages 
      WHERE spreadsheet_id = ?
    `;
    const params: any[] = [spreadsheetId];
    
    if (before) {
      query += ` AND id < ?`;
      params.push(before);
    }
    
    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(Number(limit));
    
    const messages = await db.all(query, params) as ChatMessage[];
    // Reverse to get chronological order and fix timestamps
    res.json(messages.reverse().map(fixTimestamp));
  } catch (error) {
    console.error('Error fetching chat messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Post a new message
router.post('/messages', async (req: Request, res: Response) => {
  try {
    const { spreadsheetId, senderName, message } = req.body;
    
    if (!spreadsheetId || !senderName || !message) {
      return res.status(400).json({ error: 'Spreadsheet ID, sender name, and message are required' });
    }
    
    if (message.length > 1000) {
      return res.status(400).json({ error: 'Message too long (max 1000 characters)' });
    }
    
    const db = await getDatabase();
    
    // Check if user is authenticated (admin)
    const authReq = req as AuthRequest;
    const isAdmin = authReq.user?.is_admin || false;
    const userId = authReq.user?.id || null;
    
    const trimmedName = senderName.trim();
    
    const result = await db.run(
      `INSERT INTO chat_messages (spreadsheet_id, sender_name, message, is_admin, user_id) 
       VALUES (?, ?, ?, ?, ?)`,
      [spreadsheetId, trimmedName, message.trim(), isAdmin ? 1 : 0, userId]
    );
    
    const newMessage = await db.get(
      'SELECT id, spreadsheet_id, sender_name, message, is_admin, created_at FROM chat_messages WHERE id = ?',
      [result.lastID]
    ) as ChatMessage;
    
    res.json(fixTimestamp(newMessage));
  } catch (error) {
    console.error('Error posting chat message:', error);
    res.status(500).json({ error: 'Failed to post message' });
  }
});

// Get current user info for chat (authenticated or not)
router.get('/user-info', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    
    if (authReq.user) {
      res.json({
        isAuthenticated: true,
        isAdmin: authReq.user.is_admin || false,
        name: authReq.user.name,
        id: authReq.user.id
      });
    } else {
      res.json({
        isAuthenticated: false,
        isAdmin: false,
        name: null,
        id: null
      });
    }
  } catch (error) {
    console.error('Error getting user info:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// Clear all messages in a chat room (admin only)
router.delete('/messages/:spreadsheetId', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    
    // Check if user is admin
    if (!authReq.user?.is_admin) {
      return res.status(403).json({ error: 'Only admins can clear chat messages' });
    }
    
    const { spreadsheetId } = req.params;
    const db = await getDatabase();
    
    const result = await db.run(
      'DELETE FROM chat_messages WHERE spreadsheet_id = ?',
      [spreadsheetId]
    );
    
    res.json({ 
      success: true, 
      message: `Cleared ${result.changes} messages from chat` 
    });
  } catch (error) {
    console.error('Error clearing chat messages:', error);
    res.status(500).json({ error: 'Failed to clear messages' });
  }
});

export default router;

