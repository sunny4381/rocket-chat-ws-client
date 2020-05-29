## 実行方法

~~~
$ node test.js username password
~~~

## サブコマンド

### ログアウト

~~~
command> logout
~~~

### ルーム一覧の取得

~~~
command> rooms
~~~

### テキストメッセージの送信

~~~
command> sendMessage,room-id,message
~~~

`room-id` は、ルーム一覧取得コマンドを実行し、確認してください。

### 追加・更新メッセージの Listen

~~~
command> streamRoomMessages,room-id
~~~

`room-id` は、ルーム一覧取得コマンドを実行し、確認してください。

### チャンネルの作成

~~~
command> createChannel,channel-name,user-to-join
~~~

`channel-name` に日本語は使用できません。
