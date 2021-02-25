const gremlin = require("gremlin");
const async = require("async");
const { getUrlAndHeaders } = require("gremlin-aws-sigv4/lib/utils");

const traversal = gremlin.process.AnonymousTraversalSource.traversal;
const DriverRemoteConnection = gremlin.driver.DriverRemoteConnection;
const t = gremlin.process.t;
const __ = gremlin.process.statics;

let conn: any = null;
let g: any = null;

async function query(context: any) {
  const id = context.id;

  return g
    .V(id)
    .fold()
    .coalesce(__.unfold(), __.addV("User").property(t.id, id))
    .id()
    .next();
}

async function doQuery() {
  const id = Math.floor(Math.random() * 10000).toString();

  let result = await query({ id: id });
  return result["value"];
}

exports.handler = async (event: any, context: any) => {
  const getConnectionDetails = () => {
    if (process.env["USE_IAM"] == "true") {
      return getUrlAndHeaders(
        process.env["NEPTUNE_ENDPOINT"],
        process.env["NEPTUNE_PORT"],
        {},
        "/gremlin",
        "wss"
      );
    } else {
      const database_url =
        "wss://" +
        process.env["NEPTUNE_ENDPOINT"] +
        ":" +
        process.env["NEPTUNE_PORT"] +
        "/gremlin";
      return { url: database_url, headers: {} };
    }
  };

  const createRemoteConnection = () => {
    const { url, headers } = getConnectionDetails();

    return new DriverRemoteConnection(url, {
      mimeType: "application/vnd.gremlin-v2.0+json",
      pingEnabled: false,
      headers: headers,
    });
  };

  const createGraphTraversalSource = (conn: any) => {
    return traversal().withRemote(conn);
  };

  if (conn == null) {
    console.info("Initializing connection");
    conn = createRemoteConnection();
    g = createGraphTraversalSource(conn);
  }

  return async.retry(
    {
      times: 5,
      interval: 1000,
      errorFilter: function (err: any) {
        // Add filters here to determine whether error can be retried
        console.warn("Determining whether retriable error: " + err.message);

        // Check for connection issues
        if (err.message.startsWith("WebSocket is not open")) {
          console.warn("Reopening connection");
          conn.close();
          conn = createRemoteConnection();
          g = createGraphTraversalSource(conn);
          return true;
        }

        // Check for ConcurrentModificationException
        if (err.message.includes("ConcurrentModificationException")) {
          console.warn(
            "Retrying query because of ConcurrentModificationException"
          );
          return true;
        }

        // Check for ReadOnlyViolationException
        if (err.message.includes("ReadOnlyViolationException")) {
          console.warn("Retrying query because of ReadOnlyViolationException");
          return true;
        }

        return false;
      },
    },
    doQuery
  );
};
