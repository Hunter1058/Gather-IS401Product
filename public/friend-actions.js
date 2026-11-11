/* Friend action state, independent of card layout. All confirmed state comes
 * from the account API; localStorage and the prototype friend-name array are
 * never used. Coworkers can change friendsPage()/friendCard() without changing
 * request persistence. */
"use strict";
window.GatherFriends = {
  create({ request, account, changed, notify, login, confirmRemove = () => true }) {
    let section = null, search = "", suggestionVisit = 0;
    let owner, generation = 0, people = [], nextCursor = null;
    let loading = false, ready = false, error = "", accountChanged = false;
    const pending = new Map(), problems = new Map(), retained = new Map();
    function sync() {
      const actual = account();
      if (actual !== owner) {
        owner = actual; generation++; people = []; nextCursor = null;
        loading = ready = accountChanged = false; error = "";
        pending.clear(); problems.clear(); retained.clear(); search = "";
      }
      return owner;
    }
    function current(id, token) { return token === generation && id === account() && id === owner; }
    function changedAccount() {
      accountChanged = true; ready = false;
      error = "Your account changed. Reload this page before changing friendships.";
    }
    function validated(result, id) {
      if (result.accountId !== id) {
        const failure = Error("Your account changed. Reload this page."); failure.code = "ACCOUNT_CHANGED"; throw failure;
      }
      return result;
    }
    function validPerson(person) {
      const statuses = ["none", "friends", "outgoing_pending", "incoming_pending"];
      if (!person || typeof person.name !== "string" || !person.name.trim() || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(person.id) ||
          !statuses.includes(person.relationship) ||
          (person.relationship.endsWith("_pending") &&
           (typeof person.requestId !== "string" || !/^[1-9]\d*$/.test(person.requestId))))
        throw Error("Unable to read friendship status. Please retry.");
      return person;
    }
    function view() {
      sync();
      return { people: people.map(person => ({ ...person, pending: pending.has(person.id),
        pendingAction: pending.get(person.id), error: problems.get(person.id) || "" })),
        loading, ready, error, accountChanged, search, hasMore: nextCursor !== null };
    }
    async function load(more = false, filter = null) {
      const id = sync();
      if (filter) {
        if (pending.size || accountChanged) return;
        if (section !== filter.section || search !== (filter.search || "")) retained.clear();
        section = filter.section; search = filter.search || "";
        generation++; loading = false; people = []; nextCursor = null;
      }
      const token = generation, visit = suggestionVisit;
      if (!id) { login(); return; }
      if (loading || pending.size || accountChanged) return;
      if (more && (!ready || !nextCursor)) return;
      const after = more ? nextCursor : null;
      const trigger = document.activeElement;
      loading = true; ready = false; error = ""; changed();
      try {
        const result = validated(await request("/friends/people?" + (section ? "section=" + section + "&search=" + encodeURIComponent(search) + "&" : "") + (after ? "after=" + encodeURIComponent(after) : ""),
          { headers: { "X-Gather-Account": id } }), id);
        if (!current(id, token)) return;
        if (!Array.isArray(result.people)) throw Error("Unable to load people. Please retry.");
        const incoming = result.people.map(validPerson);
        if (!more && section === "search" && !search && retained.size) {
          const restored = await Promise.all([...retained.keys()].map(async personId => {
            try {
              const response=validated(await request("/friends/people?personId="+encodeURIComponent(personId),
                {headers:{"X-Gather-Account":id}}),id);
              const person=validPerson(response.people?.[0]);
              if (person.id!==personId) throw Error("Unable to confirm this person's status.");
              return person;
            } catch (failure) { if (failure.status===404) return null; throw failure; }
          }));
          if (!current(id,token)) return;
          if (visit === suggestionVisit) {
            retained.clear(); restored.filter(Boolean).forEach(person=>retained.set(person.id,person));
            for (const person of restored.filter(Boolean)) if (!incoming.some(row=>row.id===person.id)) incoming.push(person);
          }
        }
        if (result.nextCursor != null && result.nextCursor === after) throw Error("Unable to load the next page. Please retry.");
        people = [...new Map([...(more ? people : []), ...incoming].map(person => [person.id, person])).values()];
        nextCursor = result.nextCursor || null; ready = true;
        if (!more) problems.clear();
      } catch (failure) {
        if (!current(id, token)) return;
        if (failure.code === "ACCOUNT_CHANGED") changedAccount();
        else error = failure.message || "Unable to load people. Please retry.";
      } finally {
        if (current(id, token)) {
          loading = false; changed();
          if (["friendsRefresh", "friendsMore", "friendsSearchButton"].includes(trigger?.id))
            (document.getElementById(trigger.id) || document.getElementById("friendsRefresh"))?.focus();
        }
      }
    }
    function inSection(person) {
      return !section || (section === "friends" ? person.relationship === "friends"
        : section === "requests" ? person.relationship.endsWith("_pending") : true);
    }
    function restoreFocus(id, trigger) {
      if (trigger?.dataset?.friendUserId !== id) return;
      const controls = [...document.querySelectorAll("[data-friend-user-id]")];
      (controls.find(control => control.dataset.friendUserId === id && !control.disabled)
        || document.querySelector(`[data-friend-heading="${id}"]`)
        || document.getElementById("friendsRefresh"))?.focus();
    }
    async function refreshPerson(personId) {
      const id = sync(), token = generation, visit = suggestionVisit;
      if (!id || loading || pending.has(personId) || accountChanged) return;
      const trigger = document.activeElement;
      pending.set(personId, "refresh"); changed();
      try {
        const result = validated(await request("/friends/people?personId=" + encodeURIComponent(personId),
          { headers: { "X-Gather-Account": id } }), id);
        if (!current(id, token)) return;
        const person = validPerson(result.people?.[0]);
        if (person.id !== personId) throw Error("Unable to confirm this person's status.");
        if (section === "search" && !search && visit === suggestionVisit) retained.set(personId,person);
        people = people.map(previous => previous.id === personId ? person : previous).filter(inSection);
        problems.delete(personId);
      } catch (failure) {
        if (!current(id, token)) return;
        if (failure.code === "ACCOUNT_CHANGED") changedAccount();
        else if (failure.status === 404) { people = people.filter(person => person.id !== personId); problems.delete(personId); }
        else problems.set(personId, failure.message || "Unable to refresh status.");
      } finally {
        if (current(id, token)) { pending.delete(personId); changed(); restoreFocus(personId, trigger); }
      }
    }
    async function act(personId, decision = null) {
      const id = sync(), token = generation, visit = suggestionVisit;
      if (!id) { login(); return; }
      if (!ready || loading || accountChanged || pending.has(personId) || problems.has(personId)) return;
      const person = people.find(person => person.id === personId);
      const action = person?.relationship === "incoming_pending" && ["accept", "deny"].includes(decision) ? decision : { none: "send", outgoing_pending: "cancel", friends: "remove" }[person?.relationship];
      if (!action) return;
      const trigger = document.activeElement;
      pending.set(personId, action); changed();
      try {
        if (action === "remove" && await confirmRemove(person) !== true) return;
        if (!current(id, token)) return;
        const path = ["accept", "deny"].includes(action) ? "/friends/requests/" + encodeURIComponent(person.requestId) + "/" + action
          : action === "send" ? "/friends/requests"
          : action === "cancel" ? "/friends/requests/" + encodeURIComponent(person.requestId)
          : "/friends/" + encodeURIComponent(personId);
        const result = validated(await request(path, {
          method: ["send", "accept", "deny"].includes(action) ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json", "X-Gather-Account": id },
          body: JSON.stringify(action === "send" ? { recipientId: personId } : {}),
        }), id);
        if (!current(id, token)) return;
        const confirmed = validPerson(result.person);
        if (confirmed.id !== personId) throw Error("Unable to confirm this person's status.");
        if (section === "search" && !search && visit === suggestionVisit) retained.set(personId,confirmed);
        people = people.map(previous => previous.id === personId ? confirmed : previous).filter(inSection);
        problems.delete(personId);
        const expected = { send: "outgoing_pending", cancel: "none", remove: "none", accept: "friends", deny: "none" };
        const messages = { send: "Friend request sent", cancel: "Request cancelled", remove: "Friend removed", accept: "Friend request accepted", deny: "Friend request denied" };
        notify(confirmed.relationship === expected[action] ? messages[action] : "Friendship status refreshed.");
      } catch (failure) {
        if (!current(id, token)) return;
        if (failure.code === "ACCOUNT_CHANGED") changedAccount();
        else problems.set(personId, "We couldn't confirm this change. " + (failure.message || "Refresh its status before trying again."));
      } finally {
        if (current(id, token)) { pending.delete(personId); changed(); restoreFocus(personId, trigger); }
      }
    }
    return { view, load, act, refreshPerson, discardSuggestions: () => { retained.clear(); suggestionVisit++; }, hasPending: () => pending.size > 0 };
  },
};
