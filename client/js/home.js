(function () {
  const usernameInput = document.querySelector("#username");
  const roomCodeInput = document.querySelector("#roomCode");
  const form = document.querySelector("#homeForm");
  const createRoomBtn = document.querySelector("#createRoomBtn");
  const homeError = document.querySelector("#homeError");

  usernameInput.value = localStorage.getItem("drawit:username") || "";

  function cleanUsername() {
    return usernameInput.value.replace(/\s+/g, " ").trim().slice(0, 18);
  }

  function cleanRoomCode() {
    return roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  }

  function setError(message) {
    homeError.textContent = message;
  }

  function goToRoom(mode) {
    const username = cleanUsername();
    const roomCode = cleanRoomCode();

    if (!username) {
      setError("Choose a username first.");
      usernameInput.focus();
      return;
    }

    if (mode === "join" && !roomCode) {
      setError("Enter a room code to join.");
      roomCodeInput.focus();
      return;
    }

    localStorage.setItem("drawit:username", username);
    const params = new URLSearchParams({ mode, name: username });
    if (roomCode) params.set("room", roomCode);

    window.location.href = `/room.html?${params.toString()}`;
  }

  roomCodeInput.addEventListener("input", () => {
    roomCodeInput.value = cleanRoomCode();
  });

  createRoomBtn.addEventListener("click", () => goToRoom("create"));

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    goToRoom("join");
  });
})();
