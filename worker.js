/**
 * TRUE LIVE SEC EDGAR V32 - PRODUCTION READY
 * User: Mahmoudsalem2080@gmail.com
 * SEC Compliant with Contact Email
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const CONTACT_EMAIL = env.CONTACT_EMAIL || "Mahmoudsalem2080@gmail.com";
    
    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (url.pathname === "/health" || url.pathname === "/") {
      return new Response(JSON.stringify({
        service: "TRUE LIVE SEC V32",
        status: "running",
        version: "V32",
        contact: CONTACT_EMAIL,
        endpoints: {
          search: "/?q=Apple or /?q=AAPL",
          ticker: "/?ticker=AAPL",
          cik: "/?cik=0000320193"
        },
        sec_compliant: true,
        timestamp: new Date().toISOString()
      }), { headers: corsHeaders });
    }

    // Get query
    const q = url.searchParams.get("q") || url.searchParams.get("ticker") || url.searchParams.get("cik") || url.searchParams.get("name") || "";
    if (!q) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Missing query. Use ?q=Apple or ?q=AAPL",
        example: url.origin + "/?q=AAPL"
      }), { status: 400, headers: corsHeaders });
    }

    try {
      // Step 1: Find CIK
      let cik = null;
      let companyName = q;
      let ticker = q.toUpperCase();
      
      // If CIK provided directly
      if (/^\d+$/.test(q)) {
        cik = q.padStart(10, '0');
      } else {
        // Search SEC company tickers JSON
        const tickersResp = await fetch("https://www.sec.gov/files/company_tickers.json", {
          headers: {
            "User-Agent": CONTACT_EMAIL + " TrueLiveV32",
            "Accept": "application/json"
          }
        });
        const tickersData = await tickersResp.json();
        
        // Find matching ticker or name
        const queryLower = q.toLowerCase();
        for (const key in tickersData) {
          const entry = tickersData[key];
          if (entry.ticker && entry.ticker.toLowerCase() === queryLower) {
            cik = String(entry.cik_str).padStart(10, '0');
            companyName = entry.title;
            ticker = entry.ticker;
            break;
          }
          if (entry.title && entry.title.toLowerCase().includes(queryLower)) {
            cik = String(entry.cik_str).padStart(10, '0');
            companyName = entry.title;
            ticker = entry.ticker;
            // don't break, try exact ticker first, but save this
          }
        }
        
        // If still not found, try more precise search for name contains
        if (!cik) {
          for (const key in tickersData) {
            const entry = tickersData[key];
            if (entry.title && entry.title.toLowerCase().includes(queryLower)) {
              cik = String(entry.cik_str).padStart(10, '0');
              companyName = entry.title;
              ticker = entry.ticker;
              break;
            }
          }
        }
      }

      if (!cik) {
        return new Response(JSON.stringify({
          ok: false,
          found: false,
          query: q,
          error: "Company not found in SEC EDGAR. Try ticker like AAPL, MSFT, TSLA"
        }), { status: 404, headers: corsHeaders });
      }

      // Step 2: Get company facts from SEC API
      const factsUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
      const factsResp = await fetch(factsUrl, {
        headers: {
          "User-Agent": CONTACT_EMAIL + " TrueLiveV32",
          "Accept": "application/json",
          "Host": "data.sec.gov"
        }
      });

      if (!factsResp.ok) {
        return new Response(JSON.stringify({
          ok: true,
          found: true,
          cik: cik,
          ticker: ticker,
          company: companyName,
          warning: "Found CIK but no XBRL facts yet",
          facts_url: factsUrl
        }), { headers: corsHeaders });
      }

      const facts = await factsResp.json();
      
      // Extract key financials
      const usd = facts.facts?.["us-gaap"] || {};
      const getLatest = (concept) => {
        const arr = usd[concept]?.units?.USD;
        if (!arr || !arr.length) return null;
        // sort by end date desc
        const sorted = [...arr].sort((a,b) => new Date(b.end) - new Date(a.end));
        return sorted[0];
      };

      const revenue = getLatest("Revenues") || getLatest("RevenueFromContractWithCustomerExcludingAssessedTax") || getLatest("SalesRevenueNet");
      const netIncome = getLatest("NetIncomeLoss");
      const assets = getLatest("Assets");
      
      return new Response(JSON.stringify({
        ok: true,
        found: true,
        source: "SEC EDGAR LIVE",
        cik: cik,
        cik_trimmed: parseInt(cik, 10),
        ticker: ticker,
        company: facts.entityName || companyName,
        sec_compliant_email: CONTACT_EMAIL,
        financials: {
          revenue: revenue ? { value: revenue.val, end: revenue.end, form: revenue.form } : null,
          netIncome: netIncome ? { value: netIncome.val, end: netIncome.end, form: netIncome.form } : null,
          assets: assets ? { value: assets.val, end: assets.end, form: assets.form } : null
        },
        raw_facts_url: factsUrl,
        timestamp: new Date().toISOString()
      }, null, 2), { headers: corsHeaders });

    } catch (e) {
      return new Response(JSON.stringify({
        ok: false,
        error: e.message,
        query: q,
        contact: CONTACT_EMAIL
      }), { status: 500, headers: corsHeaders });
    }
  }
}
