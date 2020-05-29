"use strict";

const WebSocket = require("ws");
const crypto = require("crypto");
const moment = require("moment");
const readline = require("readline");

const server = "http://localhost:3000/websocket";
const username = process.argv[2];
const password = process.argv[3];
if (!username || !password) {
  console.log("[Error] execute this script with username and password like:");
  console.log(`Usage: node ${process.argv[1]} username password`);
  process.exit(1);
}

class BaseCommand {
  constructor(client) {
    this.client = client;
  }
}

class ConnectCommand extends BaseCommand {
  send() {
    const self = this;
    return new Promise((resolve, reject) => {
      self.client.addResolver({ "msg": "connected", "resolve": resolve, "reject": reject });

      // connect
      const connectParams = {
        "msg": "connect",
        "version": "1",
        "support": ["1"]
      };
      self.client.ws.send(JSON.stringify(connectParams));
    });
  }
}

class BaseMethodCommand extends BaseCommand {
  send() {
    let params = this.createParams();

    const self = this;
    return new Promise((resolve, reject) => {
      const requestId = self.client.nextRequestSequence().toString();
      self.client.addResolver({ "msg": "result", id: requestId, "resolve": resolve, "reject": reject });

      params.id = requestId;
      self.client.ws.send(JSON.stringify(params));
    });
  }

  createParams() {
    return { "msg": "method" };
  }
}

class LoginCommand extends BaseMethodCommand {
  createParams() {
    return {
      "msg": "method",
      "method": "login",
      "params": [{
        "user": { "username": this.client.username },
        "password": {
          "digest": this.client.password,
          "algorithm":"sha-256"
        }
      }]
    };
  }
}

class LogoutCommand extends BaseMethodCommand {
  createParams() {
    return {
      "msg": "method",
      "method": "logout"
    };
  }
}

class GetRoomsCommand extends BaseMethodCommand {
  createParams() {
    return {
      "msg": "method",
      "method": "rooms/get",
    };
  }
}

class OpenRoomCommand extends BaseMethodCommand {
  constructor(client, roomId) {
    super(client);
    this.roomId = roomId;
  }

  createParams() {
    return {
      "msg": "method",
      "method": "openRoom",
      "params": [ this.roomId ]
    };
  }
}

class JoinRoomCommand extends BaseMethodCommand {
  constructor(client, roomId, joinCode) {
    super(client);
    this.roomId = roomId;
    this.joinCode = joinCode;
  }

  createParams() {
    let params = [ this.roomId ];
    if (this.joinCode) {
      params.push(this.joinCode);
    }

    return {
      "msg": "method",
      "method": "joinRoom",
      "params": params
    };
  }
}

class SendMessageCommand extends BaseMethodCommand {
  constructor(client, roomId, message) {
    super(client);
    this.roomId = roomId;
    this.message = message;
  }

  createParams() {
    return {
      "msg": "method",
      "method": "sendMessage",
      "params": [{
        "rid": this.roomId,
        "msg": this.message
      }]
    };
  }
}

class CreateChannelCommand extends BaseMethodCommand {
  constructor(client, channelName, ...usersToJoin) {
    super(client);
    this.channelName = channelName;
    this.usersToJoin = usersToJoin;
  }

  createParams() {
    return {
      "msg": "method",
      "method": "createChannel",
      "params": [
        this.channelName,
        this.usersToJoin,
        false
      ]
    };
  }
}

class StreamRoomMessagesCommand extends BaseCommand {
  constructor(client, roomId) {
    super(client);
    this.roomId = roomId;
  }

  call() {
    const requestId = this.client.nextRequestSequence().toString();

    let params = this.createParams();
    params.id = requestId;

    this.client.ws.send(JSON.stringify(params));

    return requestId;
  }

  createParams() {
    return {
      "msg": "sub",
      "name": "stream-room-messages",
      "params": [
        this.roomId,
        false
      ]
    };
  }
}

class RocketChatClient {
  constructor(server, username, password) {
    this.server = server;
    this.username = username;
    this.password = password;
    this.currentRequestSequence = 0;
    this.resolverList = [];
    this.credential = null;

    this.ws = new WebSocket(server);
    this.ws.on('open', () => {
      console.log({ on: "open" });
      this.handleOpen();
    });
    this.ws.on('message', (data) => {
      console.log({ on: "message", data: data });
      this.handleMessage(data);
    });

    this.ws.on('error', (err) => {
      console.log({ on: "error", err: err });
    });

    this.ws.on('close', (code, message) => {
      console.log({ on: "close", code: code, message: message });
    });

    this.ws.on("unexpected-response", (req, res) => {
      console.log({ on: "unexpected-response", req: req, res: res });
      return false;
    });

    // this.ws.on("upgrade", (res) => {
    //   console.log({ on: "upgrade", res: res });
    // });

    this.ws.on("ping", (data) => {
      console.log({ on: "ping", data: data });
    });

    this.ws.on("pong", (data) => {
      console.log({ on: "pong", data: data });
    });
  }

  nextRequestSequence() {
    this.currentRequestSequence++;
    return this.currentRequestSequence;
  }

  addResolver(resolverConfig) {
    this.resolverList.push(resolverConfig);
  }

  shiftResolver(msg, id) {
    const found = this.resolverList.findIndex((resolverConfig) => {
      if (resolverConfig.msg !== msg) {
        return false;
      }
      if (id && resolverConfig.id !== id) {
        return false;
      }
      return true;
    });

    if (found === -1) {
      return null;
    }

    const ret = this.resolverList[found];
    this.resolverList.splice(found, 1);
    return ret;
  }

  async handleOpen() {
    await new ConnectCommand(this).send();
    const loginResponse = await new LoginCommand(this).send();

    const tokenExpires = moment(loginResponse.result.tokenExpires["$date"]);
    this.credential = { id: loginResponse.result.id, token: loginResponse.result.token, tokenExpires: tokenExpires };

    this.startListeningCommand();
  }

  handleMessage(data) {
    const message = JSON.parse(data);
    const name = message.msg;
    if (name === "connected") {
      const resolver = this.shiftResolver("connected");
      if (resolver) {
        resolver.resolve(message);
      }
    } else if (name === "added") {
      const resolver = this.shiftResolver("added", message.id);
      if (resolver) {
        resolver.resolve(message);
      }
    } else if (name === "result") {
      const resolver = this.shiftResolver("result", message.id);
      if (resolver) {
        resolver.resolve(message);
      }
    } else if (name === "updated") {
      const resolver = this.shiftResolver("updated", message.id);
      if (resolver) {
        resolver.resolve(message);
      }
    } else if (name === "ping") {
      this.handleMessagePing()
    }
  }

  handleMessagePing() {
    const pongParams = {
      "msg": "pong"
    };
    this.ws.send(JSON.stringify(pongParams));
  }

  startListeningCommand() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });
    rl.setPrompt("command> ");

    const self = this;
    rl.prompt();
    rl.on('line', async (line) => {
      const terms = line.split(",");
      const command = terms[0].trim();

      if (line === "logout") {
        await new LogoutCommand(self).send();
        rl.close();
        process.exit(0);
      } else if (command === "rooms") {
        const roomsResponse = await new GetRoomsCommand(self).send();
        const rooms = roomsResponse.result;
        rooms.forEach((room) => {
          console.log({ room: room });
        });
      } else if (command === "openRoom") {
        const openRoomResponse = await new OpenRoomCommand(self, terms[1]).send();
        console.log({ openRoomResponse: openRoomResponse });
      } else if (command === "joinRoom") {
        const joinRoomResponse = await new JoinRoomCommand(self, terms[1], terms[2]).send();
        console.log({ joinRoomResponse: joinRoomResponse });
      } else if (command === "sendMessage") {
        const sendMessageResponse = await new SendMessageCommand(self, terms[1], terms[2]).send();
        console.log({ sendMessageResponse: sendMessageResponse });
      } else if (command === "streamRoomMessages") {
        const subscriptionId = new StreamRoomMessagesCommand(self, terms[1]).call();
        console.log({ subscriptionId: subscriptionId });
      } else if (command === "createChannel") {
        const createChannelResponse = await new CreateChannelCommand(self, terms[1], terms[2]).send();
        console.log({ createChannelResponse: createChannelResponse });
      }

      rl.prompt();
    });
  }
}

const hashedPassword = crypto.createHash("sha256").update(password).digest("hex").toLocaleLowerCase();
const client = new RocketChatClient(server, username, hashedPassword);
