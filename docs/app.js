(function () {
  "use strict";

  var els = {
    location: document.getElementById("status-location"),
    earliest: document.getElementById("status-earliest"),
    checked: document.getElementById("status-checked"),
    message: document.getElementById("status-message"),
  };

  function setNoStatus(reason) {
    els.earliest.textContent = "No recent status available";
    els.checked.textContent = "—";
    if (reason) {
      els.message.textContent = reason;
    }
  }

  function formatChecked(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    try {
      return d.toLocaleString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch (e) {
      return d.toISOString();
    }
  }

  function render(status) {
    if (!status || typeof status !== "object") {
      setNoStatus("No recent status available.");
      return;
    }

    if (status.location) {
      els.location.textContent = status.location;
    }

    if (status.ok === false) {
      els.earliest.textContent = "Automated check failed";
      els.checked.textContent = formatChecked(status.checkedAt);
      els.message.textContent = status.message || "Automated check failed.";
      return;
    }

    if (status.earliest && status.earliest.date) {
      var when = status.earliest.date;
      if (status.earliest.time) when += " " + status.earliest.time;
      els.earliest.textContent = when;
    } else {
      els.earliest.textContent = "No available slots at last check";
    }

    els.checked.textContent = formatChecked(status.checkedAt);

    if (status.message) {
      els.message.textContent = status.message;
    } else {
      els.message.textContent = "";
    }
  }

  fetch("./status.json", { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(render)
    .catch(function () {
      setNoStatus("No recent status available.");
    });
})();
