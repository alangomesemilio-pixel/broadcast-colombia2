# 📞 Broadcast Colombia · Twilio

App de disparo de áudio em massa para a Colômbia usando Twilio.

---

## 🚀 Passo a passo para colocar no ar

### Passo 1 — Criar conta no Twilio (5 min)
1. Acesse https://twilio.com/try-twilio
2. Preencha nome, e-mail e senha
3. Confirme o e-mail e o telefone
4. No painel, copie na tela principal:
   - **Account SID** (começa com AC...)
   - **Auth Token** (clique no olho para revelar)

### Passo 2 — Comprar número colombiano (2 min)
1. No painel: **Phone Numbers → Manage → Buy a number**
2. Country: **Colombia**
3. Compre um número (~$1/mês)
4. Este número vai no campo "Número de origem" do app

### Passo 3 — Liberar ligações internacionais
1. Vá em: **Voice → Settings → Geo Permissions**
2. Ative **Colombia**
3. Para volume alto: **Voice → Limits** → peça aumento de limite

### Passo 4 — Subir no Railway (10 min)
1. Acesse https://railway.app → login com GitHub
2. **New Project → Deploy from GitHub repo**
   - Suba esta pasta no GitHub primeiro (github.com → New repo → upload files)
   - Ou use: **New Project → Deploy from local** arrastando a pasta
3. Railway detecta o `package.json` e sobe automaticamente
4. Vá em **Settings → Domains → Generate Domain**
5. Copie a URL gerada (ex: `https://twilio-broadcast.railway.app`)

### Passo 5 — Usar o app
1. Abra a URL do Railway no navegador
2. Cole o **Account SID** e **Auth Token**
3. Cole o número comprado no campo "Número de origem"
4. Cole a URL do Railway no campo "URL base"
5. Faça upload do **CSV** com os números colombianos
6. Faça upload do **MP3** gravado pela influencer
7. Clique **Iniciar campanha** ▶

---

## 📋 Formato do CSV

```
telefone
3001234567
3109876543
3204567890
```

Números sem +57 são prefixados automaticamente.

---

## 💰 Custo Twilio vs Plivo para 40k ligações (20s)

| Plataforma | Tarifa/min Colômbia | Custo 40k ligações* |
|-----------|-------------------|-------------------|
| Twilio | $0.013/min | ~$173 |
| Plivo | $0.033/min | ~$440 |

*Estimando 35% de atendimento, 20 segundos por ligação atendida

O Twilio é mais caro por minuto para alguns destinos, mas mais barato para Colômbia mobile.

---

## ❓ Dúvidas comuns

**Erro "Geo Permission not enabled"?**
Ative Colombia em: console.twilio.com → Voice → Settings → Geo Permissions

**Erro "Account not authorized"?**
Conta trial só liga para números verificados. Faça upgrade para conta paga.

**Ligações falhando?**
Reduza o lote para 3-5 e aguarde. Contas novas têm limite baixo.
