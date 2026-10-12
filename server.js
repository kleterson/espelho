const express = require('express');
const path = require('path');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;


// ⚙️ Conexão com o Supabase (PostgreSQL via Pooler)
const connectionString = process.env.DATABASE_URL;
const sql = postgres(connectionString, { 
    ssl: 'require',
    family: 4
});

// Testar conexão ao iniciar
async function testarConexao() {
    try {
        const result = await sql`SELECT NOW()`;
        console.log('Conectado ao Supabase (PostgreSQL) com sucesso!', result[0].now);
    } catch (err) {
        console.error('Erro ao conectar ao Supabase:', err.message);
    }
}
testarConexao();

app.use(cors());
app.use(express.json({ limit: '15mb' }));

// Servir ficheiros estáticos da pasta 'www'
app.use(express.static(path.join(__dirname, 'www')));

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// --- AUTENTICAÇÃO / LOGIN ---
app.post('/api/login', async (req, res) => {
    const { nome, senha } = req.body;
    
    let { data: user, error } = await supabase
        .from('usuarios')
        .select('*')
        .eq('nome', nome)
        .single();

    if (!user) {
        const cargo = nome.toLowerCase() === 'admin' ? 'admin' : 'funcionario';
        const { data: newUser, err } = await supabase
            .from('usuarios')
            .insert([{ nome, senha, cargo }])
            .select()
            .single();
        
        if (err) return res.status(500).json({ error: err.message });
        return res.json(newUser);
    }

    if (user.senha !== senha) {
        return res.status(401).json({ error: 'Senha incorreta!' });
    }

    res.json(user);
});

// Listar todos os utilizadores (para o Admin)
app.get('/api/usuarios', async (req, res) => {
    const { data, error } = await supabase.from('usuarios').select('*');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// --- CRIAR FUNCIONÁRIO (ADMIN) ---
app.post('/api/admin/criar-funcionario', async (req, res) => {
    try {
        const { nome, senha } = req.body;

        if (!/^\d+$/.test(senha)) {
            return res.status(400).json({ error: 'A senha deve conter apenas números.' });
        }

        const { data, error } = await supabase
            .from('usuarios')
            .insert([{ nome, senha, cargo: 'funcionario' }])
            .select()
            .single();

        if (error) throw error;

        res.json({ success: true, user: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- PONTOS ---
app.get('/api/pontos/:usuario_id', async (req, res) => {
    const { usuario_id } = req.params;
    const { data, error } = await supabase
        .from('pontos')
        .select('*')
        .eq('usuario_id', usuario_id);
    
    if (error) return res.status(500).json({ error: error.message });
    const result = {};
    data.forEach(r => { result[r.data] = r; });
    res.json(result);
});

app.post('/api/pontos', async (req, res) => {
    const { usuario_id, data, entrada, pausa, retorno, saida, foto } = req.body;
    
    const { error } = await supabase
        .from('pontos')
        .upsert({ usuario_id, data, entrada, pausa, retorno, saida, foto }, { onConflict: 'usuario_id,data' });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ status: 'ok' });
});

app.post('/api/admin/lancar-status', async (req, res) => {
    const { usuario_id, data, status } = req.body;
    const { error } = await supabase
        .from('pontos')
        .upsert({ 
            usuario_id, 
            data, 
            entrada: status, 
            pausa: status, 
            retorno: status, 
            saida: status, 
            foto: null 
        }, { onConflict: 'usuario_id,data' });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ status: 'ok' });
});

app.delete('/api/pontos/:usuario_id/:mes', async (req, res) => {
    const { usuario_id, mes } = req.params;
    const { data, error } = await supabase
        .from('pontos')
        .delete()
        .eq('usuario_id', usuario_id)
        .like('data', `${mes}-%`);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ status: 'ok' });
});

// --- SOLICITAÇÕES ---
app.get('/api/solicitacoes', async (req, res) => {
    const { data, error } = await supabase
        .from('solicitacoes')
        .select('*, usuarios(nome)')
        .eq('status', 'pendente');

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/solicitacoes', async (req, res) => {
    const { usuario_id, funcionario, data, tipo, horario, motivo } = req.body;
    const { error } = await supabase
        .from('solicitacoes')
        .insert([{ usuario_id, funcionario, data, tipo, horario, motivo, status: 'pendente' }]);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ status: 'ok' });
});

app.post('/api/solicitacoes/responder', async (req, res) => {
    const { id, acao, usuario_id, data, tipo, horario } = req.body;
    
    const { error } = await supabase
        .from('solicitacoes')
        .update({ status: acao })
        .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });

    if (acao === 'aceito') {
        let { data: p } = await supabase.from('pontos').select('*').eq('usuario_id', usuario_id).eq('data', data).single();
        if (!p) {
            p = { usuario_id, data, entrada: '-', pausa: '-', retorno: '-', saida: '-', foto: null };
        }
        p[tipo] = horario;

        await supabase.from('pontos').upsert(p, { onConflict: 'usuario_id,data' });
    }

    res.json({ status: 'ok' });
});

app.get('/api/admin/todos-pontos', async (req, res) => {
    const { data, error } = await supabase.from('pontos').select('*, usuarios(nome)');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor a correr na porta ${PORT}`);
});