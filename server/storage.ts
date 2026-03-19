import { messages, type Message, type InsertMessage } from "@shared/schema";

export interface IStorage {
  getMessages(): Promise<Message[]>;
  createMessage(msg: InsertMessage): Promise<Message>;
  clearMessages(): Promise<void>;
}

export class MemStorage implements IStorage {
  private messages: Message[];
  private currentId: number;

  constructor() {
    this.messages = [];
    this.currentId = 1;
  }

  async getMessages(): Promise<Message[]> {
    return this.messages;
  }

  async createMessage(msg: InsertMessage): Promise<Message> {
    const message: Message = {
      ...msg,
      id: this.currentId++,
      createdAt: new Date(),
    };
    this.messages.push(message);
    return message;
  }

  async clearMessages(): Promise<void> {
    this.messages = [];
  }
}

export const storage = new MemStorage();
