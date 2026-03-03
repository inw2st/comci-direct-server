const { getApp } = require("./app");

getApp()
  .then((app) => {
    const port = Number(process.env.PORT || 3000);
    app.listen(port, () => {
      console.log(`comci-direct-server listening on :${port}`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
